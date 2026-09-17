use super::*;

#[test]
fn extracts_brazilian_email() {
    assert_eq!(
        extract_email("Assunto: Vaga Dev. Envie para vagas@empresa.com.br"),
        Some("vagas@empresa.com.br".to_owned()),
    );
}

#[test]
fn returns_none_when_no_email() {
    assert_eq!(
        extract_email("Nenhum email aqui, apenas texto normal."),
        None,
    );
}
