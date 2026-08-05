//! CV rewrite → PDF export: fresh single-column PDF or metadata injection into an existing PDF.
//! Key: `build_pdf` — render a fresh PDF from `CvRewrite` via lopdf.
//! Key: `embed_metadata` — inject `CvMetadata` into an existing PDF's Info dictionary.
//! Key: `build_pdf_tex` — compile via xelatex + `curriculo.cls`, then embed metadata.
//! Key: `ExportMode` — New vs Modify export path selector.

use std::path::{Path, PathBuf};

use lopdf::content::{Content, Operation};
use lopdf::{Dictionary, Document, Object, Stream, StringFormat};

use crate::ai::prompt::{CvMetadata, CvRewrite};

const PAGE_W: f32 = 612.0;
const PAGE_H: f32 = 792.0;
const LEFT: f32 = 56.0;
const TOP: f32 = 750.0;
const BOTTOM: f32 = 56.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportMode {
    New,
    Modify,
}

impl ExportMode {
    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "modify" | "existing" | "modify-existing" => ExportMode::Modify,
            _ => ExportMode::New,
        }
    }
}

struct Line {
    text: String,
    size: f32,
    indent: f32,
    gap_before: f32,
}

pub fn build_pdf(cv: &CvRewrite, meta: &CvMetadata) -> Result<Vec<u8>, String> {
    let mut doc = Document::with_version("1.5");

    let mut font = Dictionary::new();
    font.set("Type", Object::Name(b"Font".to_vec()));
    font.set("Subtype", Object::Name(b"Type1".to_vec()));
    font.set("BaseFont", Object::Name(b"Helvetica".to_vec()));
    font.set("Encoding", Object::Name(b"WinAnsiEncoding".to_vec()));
    let font_id = doc.add_object(Object::Dictionary(font));

    let mut fonts = Dictionary::new();
    fonts.set("F1", Object::Reference(font_id));
    let mut resources = Dictionary::new();
    resources.set("Font", Object::Dictionary(fonts));
    let resources_id = doc.add_object(Object::Dictionary(resources));

    let pages_id = doc.new_object_id();

    let lines = layout_lines(cv);
    let mut kids: Vec<Object> = Vec::new();
    for ops in paginate(&lines) {
        let content = Content { operations: ops };
        let encoded = content
            .encode()
            .map_err(|e| format!("encode content: {e}"))?;
        let content_id = doc.add_object(Stream::new(Dictionary::new(), encoded));

        let mut page = Dictionary::new();
        page.set("Type", Object::Name(b"Page".to_vec()));
        page.set("Parent", Object::Reference(pages_id));
        page.set("Contents", Object::Reference(content_id));
        let page_id = doc.add_object(Object::Dictionary(page));
        kids.push(Object::Reference(page_id));
    }
    let count = kids.len() as i64;

    let mut pages = Dictionary::new();
    pages.set("Type", Object::Name(b"Pages".to_vec()));
    pages.set("Kids", Object::Array(kids));
    pages.set("Count", Object::Integer(count));
    pages.set("Resources", Object::Reference(resources_id));
    pages.set(
        "MediaBox",
        Object::Array(vec![
            Object::Integer(0),
            Object::Integer(0),
            Object::Real(PAGE_W),
            Object::Real(PAGE_H),
        ]),
    );
    doc.set_object(pages_id, Object::Dictionary(pages));

    let mut catalog = Dictionary::new();
    catalog.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog.set("Pages", Object::Reference(pages_id));
    let catalog_id = doc.add_object(Object::Dictionary(catalog));
    doc.trailer.set("Root", Object::Reference(catalog_id));

    let info_id = doc.add_object(Object::Dictionary(info_dict(meta)));
    doc.trailer.set("Info", Object::Reference(info_id));

    save(&mut doc)
}

pub fn embed_metadata(pdf_bytes: &[u8], meta: &CvMetadata) -> Result<Vec<u8>, String> {
    let mut doc = Document::load_mem(pdf_bytes).map_err(|e| format!("load source pdf: {e}"))?;
    let new_info = info_dict(meta);

    let existing = match doc.trailer.get(b"Info") {
        Ok(Object::Reference(id)) => Some(*id),
        _ => None,
    };
    match existing {
        Some(id) => match doc.get_object_mut(id) {
            Ok(Object::Dictionary(d)) => {
                for (k, v) in new_info.into_iter() {
                    d.set(k, v);
                }
            }
            _ => doc.set_object(id, Object::Dictionary(new_info)),
        },
        None => {
            let id = doc.add_object(Object::Dictionary(new_info));
            doc.trailer.set("Info", Object::Reference(id));
        }
    }

    save(&mut doc)
}

struct ScratchDir(PathBuf);

impl Drop for ScratchDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

impl ScratchDir {
    fn new() -> Result<Self, String> {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir =
            std::env::temp_dir().join(format!("hiremeops-cvtex-{}-{}", std::process::id(), nanos));
        std::fs::create_dir_all(&dir).map_err(|e| format!("create scratch dir: {e}"))?;
        Ok(ScratchDir(dir))
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

pub fn build_pdf_tex(
    cv: &CvRewrite,
    meta: &CvMetadata,
    cvtex_dir: &Path,
    photo: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    let cls_src = cvtex_dir.join("curriculo.cls");
    if !cls_src.is_file() {
        return Err(format!(
            "curriculo.cls not found in {}",
            cvtex_dir.display()
        ));
    }
    let fontdir = cvtex_dir.join("fontdir");
    if !fontdir.is_dir() {
        return Err(format!("fontdir not found in {}", cvtex_dir.display()));
    }

    let scratch = ScratchDir::new()?;
    let work = scratch.path();

    std::fs::copy(&cls_src, work.join("curriculo.cls"))
        .map_err(|e| format!("copy curriculo.cls: {e}"))?;

    // Photo: write the bytes into the workdir and point the tex at that local filename.
    // Always overwrite photo_url here so a raw URL (or a stale local name) never reaches
    // \photo{}. No bytes → empty → generate_resume_tex omits the photo entirely.
    let mut cv_local = cv.clone();
    cv_local.photo_url = match photo {
        Some(bytes) if !bytes.is_empty() => {
            let name = format!("cvphoto.{}", photo_ext(bytes));
            std::fs::write(work.join(&name), bytes).map_err(|e| format!("write cv photo: {e}"))?;
            name
        }
        _ => String::new(),
    };

    let tex = crate::cv::latex::generate_resume_tex(&cv_local);
    std::fs::write(work.join("resume.tex"), tex.as_bytes())
        .map_err(|e| format!("write resume.tex: {e}"))?;

    let osfontdir = fontdir
        .canonicalize()
        .map_err(|e| format!("resolve fontdir: {e}"))?;

    for pass in 1..=2 {
        let output = std::process::Command::new("xelatex")
            .current_dir(work)
            .env("OSFONTDIR", &osfontdir)
            .arg("-interaction=nonstopmode")
            .arg("-halt-on-error")
            .arg("resume.tex")
            .output()
            .map_err(|e| format!("spawn xelatex (pass {pass}): {e}"))?;

        if !output.status.success() {
            let log = std::fs::read_to_string(work.join("resume.log")).unwrap_or_default();
            let detail = tex_error_tail(&log).unwrap_or_else(|| {
                String::from_utf8_lossy(&output.stdout)
                    .chars()
                    .rev()
                    .take(600)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect()
            });
            return Err(format!("xelatex failed (pass {pass}): {detail}"));
        }
    }

    let pdf_path = work.join("resume.pdf");
    let pdf_bytes =
        std::fs::read(&pdf_path).map_err(|e| format!("read compiled resume.pdf: {e}"))?;
    if !pdf_bytes.starts_with(b"%PDF") {
        return Err("xelatex produced a non-PDF output".to_string());
    }

    embed_metadata(&pdf_bytes, meta)
}

/// Sniff a photo's container from its magic bytes so xelatex's graphics driver picks the
/// right loader (the extension, not the content, decides how graphicx reads it).
/// Unknown/headerless bytes default to png.
fn photo_ext(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "jpg"
    } else if bytes.starts_with(b"%PDF") {
        "pdf"
    } else {
        "png"
    }
}

fn tex_error_tail(log: &str) -> Option<String> {
    let start = log
        .find("\n!")
        .map(|i| i + 1)
        .or_else(|| log.starts_with('!').then_some(0))?;
    let tail: String = log[start..].lines().take(12).collect::<Vec<_>>().join("\n");
    Some(tail.chars().take(800).collect())
}

fn save(doc: &mut Document) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    doc.save_to(&mut buf)
        .map_err(|e| format!("save pdf: {e}"))?;
    Ok(buf)
}

fn info_dict(meta: &CvMetadata) -> Dictionary {
    let mut d = Dictionary::new();
    d.set("Title", lit(&meta.title));
    d.set("Author", lit(&meta.author));
    d.set("Subject", lit(&meta.subject));
    d.set("Keywords", lit(&meta.keywords));
    d.set("Category", lit(&meta.category));
    d.set("Description", lit(&meta.description));
    d.set("Creator", lit(&meta.author));
    d.set("Producer", lit(&meta.author));
    d
}

fn lit(s: &str) -> Object {
    Object::String(to_winansi(s), StringFormat::Literal)
}

fn to_winansi(s: &str) -> Vec<u8> {
    s.chars()
        .map(|c| if (c as u32) <= 0xFF { c as u8 } else { b'?' })
        .collect()
}

fn line_height(size: f32) -> f32 {
    size * 1.3
}

fn layout_lines(cv: &CvRewrite) -> Vec<Line> {
    let mut lines: Vec<Line> = Vec::new();

    if !cv.name.trim().is_empty() {
        lines.push(Line {
            text: cv.name.trim().to_string(),
            size: 20.0,
            indent: 0.0,
            gap_before: 0.0,
        });
    }
    if !cv.positions.is_empty() {
        lines.push(Line {
            text: cv.positions.join("  |  "),
            size: 11.0,
            indent: 0.0,
            gap_before: 2.0,
        });
    }

    if !cv.summary.trim().is_empty() {
        push_heading(&mut lines, "SUMMARY");
        push_wrapped(&mut lines, cv.summary.trim(), 11.0, 0.0, 95);
    }

    if !cv.skills.is_empty() {
        push_heading(&mut lines, "SKILLS");
        for g in &cv.skills {
            let text = if g.category.trim().is_empty() {
                g.skills.trim().to_string()
            } else {
                format!("{}: {}", g.category.trim(), g.skills.trim())
            };
            push_wrapped(&mut lines, &text, 11.0, 0.0, 95);
        }
    }

    if !cv.experience.is_empty() {
        push_heading(&mut lines, "EXPERIENCE");
        for e in &cv.experience {
            let head = entry_head(&e.title, &e.organization, &e.location, &e.dates);
            lines.push(Line {
                text: head,
                size: 12.0,
                indent: 0.0,
                gap_before: 6.0,
            });
            for b in &e.bullets {
                push_wrapped(&mut lines, &format!("- {}", b.trim()), 11.0, 12.0, 90);
            }
        }
    }

    if !cv.education.is_empty() {
        push_heading(&mut lines, "EDUCATION");
        for e in &cv.education {
            let head = entry_head(&e.degree, &e.institution, &e.location, &e.dates);
            lines.push(Line {
                text: head,
                size: 12.0,
                indent: 0.0,
                gap_before: 6.0,
            });
            for b in &e.bullets {
                push_wrapped(&mut lines, &format!("- {}", b.trim()), 11.0, 12.0, 90);
            }
        }
    }

    if lines.is_empty() {
        lines.push(Line {
            text: "(empty rewrite)".to_string(),
            size: 12.0,
            indent: 0.0,
            gap_before: 0.0,
        });
    }
    lines
}

fn push_heading(lines: &mut Vec<Line>, title: &str) {
    lines.push(Line {
        text: title.to_string(),
        size: 13.0,
        indent: 0.0,
        gap_before: 12.0,
    });
}

fn push_wrapped(lines: &mut Vec<Line>, text: &str, size: f32, indent: f32, max_chars: usize) {
    for (i, chunk) in wrap(text, max_chars).into_iter().enumerate() {
        lines.push(Line {
            text: chunk,
            size,
            indent: if i == 0 { indent } else { indent + 12.0 },
            gap_before: if i == 0 { 2.0 } else { 0.0 },
        });
    }
}

fn entry_head(a: &str, b: &str, location: &str, dates: &str) -> String {
    let mut head = a.trim().to_string();
    if !b.trim().is_empty() {
        if head.is_empty() {
            head = b.trim().to_string();
        } else {
            head.push_str(" - ");
            head.push_str(b.trim());
        }
    }
    let mut tail: Vec<String> = Vec::new();
    if !location.trim().is_empty() {
        tail.push(location.trim().to_string());
    }
    if !dates.trim().is_empty() {
        tail.push(dates.trim().to_string());
    }
    if !tail.is_empty() {
        head.push_str(&format!(" ({})", tail.join(", ")));
    }
    head
}

fn wrap(text: &str, max_chars: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    for word in text.split_whitespace() {
        if cur.is_empty() {
            cur.push_str(word);
        } else if cur.chars().count() + 1 + word.chars().count() <= max_chars {
            cur.push(' ');
            cur.push_str(word);
        } else {
            out.push(std::mem::take(&mut cur));
            cur.push_str(word);
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    if out.is_empty() {
        out.push(String::new());
    }
    out
}

fn paginate(lines: &[Line]) -> Vec<Vec<Operation>> {
    let mut pages: Vec<Vec<Operation>> = Vec::new();
    let mut ops: Vec<Operation> = Vec::new();
    let mut y = TOP;

    for line in lines {
        let lh = line_height(line.size);
        y -= line.gap_before + lh;
        if y < BOTTOM {
            pages.push(std::mem::take(&mut ops));
            y = TOP - lh;
        }
        ops.push(Operation::new("BT", vec![]));
        ops.push(Operation::new(
            "Tf",
            vec![Object::Name(b"F1".to_vec()), Object::Real(line.size)],
        ));
        ops.push(Operation::new(
            "Td",
            vec![Object::Real(LEFT + line.indent), Object::Real(y)],
        ));
        ops.push(Operation::new("Tj", vec![lit(&line.text)]));
        ops.push(Operation::new("ET", vec![]));
    }
    if !ops.is_empty() {
        pages.push(ops);
    }
    if pages.is_empty() {
        pages.push(Vec::new());
    }
    pages
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::prompt::{CvEducationEntry, CvExperienceEntry, CvSkillGroup, Language};

    fn sample() -> CvRewrite {
        CvRewrite {
            name: "Ana Sobral".to_string(),
            contact: Default::default(),
            positions: vec!["Backend Engineer".to_string(), "Rust Developer".to_string()],
            summary: "Pragmatic engineer with a decade shipping local-first tools. ".repeat(6),
            skills: vec![CvSkillGroup {
                category: "Languages".to_string(),
                skills: "Rust, TypeScript, Python".to_string(),
            }],
            experience: vec![CvExperienceEntry {
                title: "Senior Engineer".to_string(),
                organization: "SobralCybersec".to_string(),
                location: "Remote".to_string(),
                dates: "2020—2025".to_string(),
                bullets: vec!["Led the automation cockpit rewrite.".to_string()],
            }],
            education: vec![CvEducationEntry {
                degree: "BSc Computer Science".to_string(),
                institution: "Universidade Federal".to_string(),
                location: "Brazil".to_string(),
                dates: "2012—2016".to_string(),
                bullets: vec![],
            }],
            language: Language::En,
            ..Default::default()
        }
    }

    #[test]
    fn build_pdf_emits_a_loadable_document() {
        let cv = sample();
        let meta = cv.cv_metadata();
        let bytes = build_pdf(&cv, &meta).expect("build");
        assert!(bytes.starts_with(b"%PDF"), "must be a PDF");
        let doc = Document::load_mem(&bytes).expect("reload");
        let info_ref = doc.trailer.get(b"Info").expect("info");
        let info_id = match info_ref {
            Object::Reference(id) => *id,
            _ => panic!("Info not a reference"),
        };
        let info = doc.get_object(info_id).unwrap().as_dict().unwrap();
        let title = info.get(b"Title").unwrap().as_str().unwrap();
        assert_eq!(title, meta.title.as_bytes());
        let category = info.get(b"Category").unwrap().as_str().unwrap();
        assert_eq!(category, b"CV");
    }

    #[test]
    fn embed_metadata_preserves_pages_and_tags_info() {
        let cv = sample();
        let meta = cv.cv_metadata();
        let base = build_pdf(&cv, &meta).expect("build");
        let tagged = embed_metadata(&base, &meta).expect("embed");
        let doc = Document::load_mem(&tagged).expect("reload");
        assert_eq!(
            doc.get_pages().len(),
            Document::load_mem(&base).unwrap().get_pages().len()
        );
        let info_id = match doc.trailer.get(b"Info").unwrap() {
            Object::Reference(id) => *id,
            _ => panic!("no info"),
        };
        let info = doc.get_object(info_id).unwrap().as_dict().unwrap();
        assert_eq!(
            info.get(b"Author").unwrap().as_str().unwrap(),
            meta.author.as_bytes()
        );
    }

    #[test]
    fn build_pdf_tex_compiles_via_xelatex() {
        if std::process::Command::new("xelatex")
            .arg("--version")
            .output()
            .is_err()
        {
            eprintln!("skipping: xelatex not available");
            return;
        }
        let cvtex = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/cvtex");
        if !cvtex.join("curriculo.cls").is_file() {
            eprintln!("skipping: resources/cvtex not present");
            return;
        }

        let cv = sample();
        let meta = cv.cv_metadata();
        let bytes = build_pdf_tex(&cv, &meta, &cvtex, None).expect("xelatex compile");
        assert!(bytes.starts_with(b"%PDF"), "must be a PDF");

        let doc = Document::load_mem(&bytes).expect("reload");
        let info_id = match doc.trailer.get(b"Info").expect("info") {
            Object::Reference(id) => *id,
            _ => panic!("Info not a reference"),
        };
        let info = doc.get_object(info_id).unwrap().as_dict().unwrap();
        assert_eq!(
            info.get(b"Title").unwrap().as_str().unwrap(),
            meta.title.as_bytes()
        );
        assert_eq!(info.get(b"Category").unwrap().as_str().unwrap(), b"CV");
        assert!(!doc.get_pages().is_empty(), "must have at least one page");
    }

    #[test]
    fn export_mode_parse_defaults_to_new() {
        assert_eq!(ExportMode::parse("modify"), ExportMode::Modify);
        assert_eq!(ExportMode::parse("MODIFY"), ExportMode::Modify);
        assert_eq!(ExportMode::parse("new"), ExportMode::New);
        assert_eq!(ExportMode::parse("garbage"), ExportMode::New);
    }

    #[test]
    fn wrap_never_drops_words() {
        let text = "one two three four five six seven eight nine ten";
        let wrapped = wrap(text, 12);
        let rejoined = wrapped.join(" ");
        assert_eq!(rejoined, text);
    }
}
