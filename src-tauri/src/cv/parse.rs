//! PDF / DOCX → text + page count + section headings. Pure: operates on bytes
//! so it is fully unit-testable without touching Tauri or the filesystem.

use std::io::{Cursor, Read};

use super::sections::detect_sections;

/// A supported CV document format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocKind {
    Pdf,
    Docx,
}

/// The structured result of parsing a document's bytes.
#[derive(Debug, Clone)]
pub struct ParsedDocument {
    /// Extracted plain text (best-effort).
    pub text: String,
    /// Page count when derivable (PDF); `None` for DOCX or if it can't be read.
    pub page_count: Option<u32>,
    /// Detected section headings, in document order.
    pub sections: Vec<String>,
}

/// Errors surfaced by parsing. Always returned as a value — parsing never
/// panics across the boundary (see the `catch_unwind` guard in `parse_pdf`).
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("pdf parse failed: {0}")]
    Pdf(String),
    #[error("docx parse failed: {0}")]
    Docx(String),
}

/// Map a file name's extension to a supported document kind (case-insensitive).
pub fn detect_kind(file_name: &str) -> Option<DocKind> {
    let ext = file_name.rsplit('.').next()?.to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => Some(DocKind::Pdf),
        "docx" => Some(DocKind::Docx),
        _ => None,
    }
}

/// Parse raw document bytes into text + page count + detected sections.
pub fn parse(kind: DocKind, bytes: &[u8]) -> Result<ParsedDocument, ParseError> {
    match kind {
        DocKind::Pdf => parse_pdf(bytes),
        DocKind::Docx => parse_docx(bytes),
    }
}

fn parse_pdf(bytes: &[u8]) -> Result<ParsedDocument, ParseError> {
    // `pdf-extract` can panic on malformed / encrypted input — never let that
    // unwind across the command boundary; turn it into a normal error.
    let text = std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(bytes))
        .map_err(|_| ParseError::Pdf("panicked while extracting text".into()))?
        .map_err(|e| ParseError::Pdf(e.to_string()))?;

    // Page count is best-effort: encrypted PDFs may refuse to load → None.
    let page_count = std::panic::catch_unwind(|| {
        lopdf::Document::load_mem(bytes)
            .ok()
            .map(|d| d.get_pages().len() as u32)
    })
    .ok()
    .flatten();

    let sections = detect_sections(&text);
    Ok(ParsedDocument {
        text,
        page_count,
        sections,
    })
}

fn parse_docx(bytes: &[u8]) -> Result<ParsedDocument, ParseError> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| ParseError::Docx(e.to_string()))?;
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|e| ParseError::Docx(format!("word/document.xml: {e}")))?
        .read_to_string(&mut xml)
        .map_err(|e| ParseError::Docx(e.to_string()))?;

    let text = docx_xml_to_text(&xml).map_err(ParseError::Docx)?;
    let sections = detect_sections(&text);
    Ok(ParsedDocument {
        text,
        page_count: None,
        sections,
    })
}

/// Extract readable text from a WordprocessingML body: concatenate `<w:t>` runs,
/// newline at each paragraph end (`</w:p>`) and explicit break (`<w:br/>`).
fn docx_xml_to_text(xml: &str) -> Result<String, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    let mut out = String::new();
    let mut in_text = false;
    loop {
        match reader.read_event().map_err(|e| e.to_string())? {
            Event::Start(e) if e.local_name().as_ref() == b"t" => in_text = true,
            Event::End(e) if e.local_name().as_ref() == b"t" => in_text = false,
            Event::End(e) if e.local_name().as_ref() == b"p" => out.push('\n'),
            Event::Empty(e) if e.local_name().as_ref() == b"br" => out.push('\n'),
            Event::Text(t) if in_text => {
                // quick-xml 0.41: `decode()` handles the byte encoding, then the
                // free `escape::unescape` resolves entities (&amp; etc.).
                let decoded = t.decode().map_err(|e| e.to_string())?;
                let unescaped =
                    quick_xml::escape::unescape(&decoded).map_err(|e| e.to_string())?;
                out.push_str(&unescaped);
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_kind_is_case_insensitive() {
        assert_eq!(detect_kind("resume.pdf"), Some(DocKind::Pdf));
        assert_eq!(detect_kind("Resume.PDF"), Some(DocKind::Pdf));
        assert_eq!(detect_kind("cv.docx"), Some(DocKind::Docx));
        assert_eq!(detect_kind("cv.DocX"), Some(DocKind::Docx));
    }

    #[test]
    fn detect_kind_rejects_unknown_and_extensionless() {
        assert_eq!(detect_kind("notes.txt"), None);
        assert_eq!(detect_kind("archive.tar.gz"), None);
        assert_eq!(detect_kind("noext"), None);
    }

    #[test]
    fn parses_pdf_fixture() {
        let bytes = include_bytes!("../../tests/fixtures/sample.pdf");
        let doc = parse(DocKind::Pdf, bytes).expect("pdf fixture parses");
        assert!(!doc.text.is_empty(), "extracted text should be non-empty");
        assert!(doc.text.contains("EXPERIENCE"), "text: {}", doc.text);
        assert_eq!(doc.page_count, Some(2), "fixture is a 2-page PDF");
        assert!(
            doc.sections.contains(&"Skills".to_string()),
            "sections: {:?}",
            doc.sections
        );
    }

    #[test]
    fn parses_docx_fixture() {
        let bytes = include_bytes!("../../tests/fixtures/sample.docx");
        let doc = parse(DocKind::Docx, bytes).expect("docx fixture parses");
        assert!(doc.text.contains("Rust"), "text: {}", doc.text);
        assert_eq!(doc.page_count, None, "DOCX has no derivable page count");
        assert!(
            doc.sections.contains(&"Summary".to_string())
                && doc.sections.contains(&"Skills".to_string()),
            "sections: {:?}",
            doc.sections
        );
    }

    #[test]
    fn docx_xml_to_text_extracts_runs_and_breaks_paragraphs() {
        let xml = r#"<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>SUMMARY</w:t></w:r></w:p>
<w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p>
</w:body></w:document>"#;
        let text = docx_xml_to_text(xml).unwrap();
        assert!(text.contains("SUMMARY"));
        assert!(text.contains("Hello world"));
        // Paragraph boundary produced a newline between the two paragraphs.
        assert!(text.contains("SUMMARY\n"));
    }
}
