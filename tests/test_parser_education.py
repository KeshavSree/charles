from parser.education import extract_education


SAMPLE = """\
UC Berkeley
Bachelor of Science in Computer Science
GPA: 3.8 | 2022

MIT
Master of Science, Computer Engineering
2024
"""


def test_extracts_two_entries():
    entries = extract_education(SAMPLE)
    assert len(entries) == 2


def test_institution_parsed():
    entries = extract_education(SAMPLE)
    assert entries[0].institution == "UC Berkeley"


def test_grad_year_parsed():
    entries = extract_education(SAMPLE)
    assert entries[0].grad_year == "2022"
    assert entries[1].grad_year == "2024"


def test_gpa_parsed():
    entries = extract_education(SAMPLE)
    assert entries[0].gpa == "3.8"


def test_degree_parsed():
    entries = extract_education(SAMPLE)
    assert "Bachelor" in entries[0].degree


def test_major_parsed():
    entries = extract_education(SAMPLE)
    assert entries[0].major == "Computer Science"
    assert entries[1].major == "Computer Engineering"


def test_empty_section_returns_empty_list():
    assert extract_education("") == []
