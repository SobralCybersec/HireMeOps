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
