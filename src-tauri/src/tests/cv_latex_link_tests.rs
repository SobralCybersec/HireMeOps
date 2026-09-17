use super::*;
use crate::ai::prompt::parse_cv_rewrite;

fn portfolio() -> CvRewrite {
    parse_cv_rewrite(include_str!("../../tests/fixtures/project-links.json"))
}

#[test]
fn project_links_replace_location_not_title() {
    let cv = portfolio();
    let tex = generate_experience(&cv);
    assert!(!tex.contains("Brasil"));
    assert!(!tex.contains("\\hfill"));
    assert!(tex.contains("{Rio Claro}"));
    for entry in cv.experience.iter().skip(1) {
        let (label, icon) = url_platform(&entry.url);
        assert!(tex.contains(&format!(
            "{{{}}}\n    {{Portfolio project}}\n    {{\\href",
            entry.title
        )));
        assert!(tex.contains(&format!("{icon}\\enspace {label}")));
        assert!(tex.contains(&format!("\\href{{{}}}", latex_escape(&entry.url))));
    }
}

#[test]
fn homepage_uses_platform_icon_in_resume_and_letter() {
    let mut cv = portfolio();
    for (url, icon) in [
        ("https://www.behance.net/designer", "\\faBehance"),
        ("https://designer.github.io", "\\faGithub"),
        ("https://gitlab.com/designer", "\\faGitlab"),
        ("https://br.linkedin.com/in/designer", "\\faLinkedin"),
        ("https://example.com", "\\faGlobe"),
    ] {
        cv.contact.website = url.into();
        for tex in [generate_resume_tex(&cv), generate_cover_letter_tex(&cv)] {
            assert!(tex.contains(&format!("\\renewcommand{{\\acvHomepageIcon}}{{{icon}}}")));
        }
    }
}

#[test]
fn link_platform_uses_hostname_and_invalid_links_keep_location() {
    assert_eq!(
        url_platform("https://example.com/behance.net"),
        ("Portfolio", "\\faGlobe")
    );
    assert_eq!(
        url_platform("https://behance.net.example.com"),
        ("Portfolio", "\\faGlobe")
    );
    let mut cv = portfolio();
    for url in [
        "javascript:alert(1)",
        "https://",
        "",
        "https://example.com has spaces",
    ] {
        cv.experience[1].url = url.into();
        assert!(generate_experience(&cv).contains("{Brasil}"));
    }
}

#[test]
fn markdown_link_labels_do_not_replace_targets() {
    let cv = parse_cv_rewrite(
        r#"{"contact":{"website":"[Behance](https://www.behance.net/designer)"},"experience":[{"title":"Project","url":"[View project](https://www.behance.net/gallery/123/PROJECT)"}]}"#,
    );
    assert_eq!(cv.contact.website, "https://www.behance.net/designer");
    assert_eq!(
        cv.experience[0].url,
        "https://www.behance.net/gallery/123/PROJECT"
    );
}

#[test]
fn portfolio_pdf_embeds_brand_font_and_project_destinations() {
    if std::process::Command::new("xelatex")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("skipping: xelatex not available");
        return;
    }
    let cv = portfolio();
    let template = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/cvtex");
    let bytes = crate::cv::export::build_pdf_tex(&cv, &cv.cv_metadata(), &template, None).unwrap();
    let doc = lopdf::Document::load_mem(&bytes).unwrap();
    let descriptor = doc
        .objects
        .values()
        .filter_map(|object| object.as_dict().ok())
        .find(|dict| {
            dict.get(b"FontName")
                .and_then(lopdf::Object::as_name)
                .is_ok_and(|name| String::from_utf8_lossy(name).contains("FontAwesome6Brands"))
        })
        .expect("embedded brand font descriptor");
    let font = descriptor
        .get(b"FontFile3")
        .unwrap()
        .as_reference()
        .unwrap();
    assert!(!doc
        .get_object(font)
        .unwrap()
        .as_stream()
        .unwrap()
        .content
        .is_empty());
    let destinations: Vec<_> = doc
        .objects
        .values()
        .filter_map(|object| pdf_link_destination(object).ok())
        .collect();
    for entry in cv.experience.iter().skip(1) {
        assert!(
            destinations.contains(&entry.url.as_bytes()),
            "missing project link: {}",
            entry.url
        );
    }
}

fn pdf_link_destination(object: &lopdf::Object) -> lopdf::Result<&[u8]> {
    object
        .as_dict()?
        .get(b"A")?
        .as_dict()?
        .get(b"URI")?
        .as_str()
}
