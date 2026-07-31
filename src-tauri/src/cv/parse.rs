//! PDF / DOCX → text + page count + section headings, byte-in text-out.
//! Key: `parse` — dispatch on `DocKind` to `parse_pdf` / `parse_docx`.
//! Key: `detect_kind` — file-extension → `DocKind`.
//! Key: `docx_xml_to_text` — WordprocessingML body → plain text.

use std::io::{Cursor, Read};

use super::sections::detect_sections;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocKind {
    Pdf,
    Docx,
}

#[derive(Debug, Clone)]
pub struct ParsedDocument {
    pub text: String,
    pub page_count: Option<u32>,
    pub sections: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("pdf parse failed: {0}")]
    Pdf(String),
    #[error("docx parse failed: {0}")]
    Docx(String),
}

pub fn detect_kind(file_name: &str) -> Option<DocKind> {
    let ext = file_name.rsplit('.').next()?.to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => Some(DocKind::Pdf),
        "docx" => Some(DocKind::Docx),
        _ => None,
    }
}

pub fn parse(kind: DocKind, bytes: &[u8]) -> Result<ParsedDocument, ParseError> {
    match kind {
        DocKind::Pdf => parse_pdf(bytes),
        DocKind::Docx => parse_docx(bytes),
    }
}

fn parse_pdf(bytes: &[u8]) -> Result<ParsedDocument, ParseError> {
    let text = std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(bytes))
        .map_err(|_| ParseError::Pdf("panicked while extracting text".into()))?
        .map_err(|e| ParseError::Pdf(e.to_string()))?;

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
                let decoded = t.decode().map_err(|e| e.to_string())?;
                let unescaped = quick_xml::escape::unescape(&decoded).map_err(|e| e.to_string())?;
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
        assert!(text.contains("SUMMARY\n"));
    }
}
