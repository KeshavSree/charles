# tests/test_parser.py
from parser.sections import detect_sections


def test_single_section_detected():
    text = "John Doe\nExperience\nSoftware Engineer at Acme Corp 2022–2024"
    result = detect_sections(text)
    assert "experience" in result
    assert "Software Engineer at Acme Corp" in result["experience"]


def test_multiple_sections_detected():
    text = (
        "EXPERIENCE\n"
        "Engineer at Foo 2020–2023\n"
        "EDUCATION\n"
        "BS Computer Science, MIT\n"
        "SKILLS\n"
        "Python, TypeScript, Go\n"
    )
    result = detect_sections(text)
    assert set(result.keys()) == {"experience", "education", "skills"}
    assert "Engineer at Foo" in result["experience"]
    assert "BS Computer Science" in result["education"]
    assert "Python" in result["skills"]


def test_missing_sections_not_included():
    text = "SKILLS\nPython"
    result = detect_sections(text)
    assert "experience" not in result
    assert "education" not in result
    assert "projects" not in result


def test_work_experience_variant():
    text = "Work Experience\nSenior Dev at Bar Inc"
    result = detect_sections(text)
    assert "experience" in result
    assert "Senior Dev" in result["experience"]


def test_technical_skills_variant():
    text = "Technical Skills\nGo, Rust, C++"
    result = detect_sections(text)
    assert "skills" in result
    assert "Go" in result["skills"]


def test_contact_info_variant():
    text = "Contact Information\njohn@example.com\n+1 555 1234"
    result = detect_sections(text)
    assert "contact" in result
    assert "john@example.com" in result["contact"]


def test_personal_information_variant():
    text = "Personal Information\nJane Smith\njane@example.com"
    result = detect_sections(text)
    assert "contact" in result


def test_text_before_first_header_discarded():
    text = "Jane Smith\njanedoe@email.com\nSKILLS\nPython"
    result = detect_sections(text)
    assert "contact" not in result
    assert "skills" in result


def test_case_insensitive_matching():
    text = "experience\nJunior Dev at Startup"
    result = detect_sections(text)
    assert "experience" in result


def test_empty_section_not_included():
    text = "EXPERIENCE\n\nEDUCATION\nMIT"
    result = detect_sections(text)
    assert "experience" not in result
    assert "education" in result
