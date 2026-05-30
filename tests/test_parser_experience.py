from parser.experience import extract_experience


SAMPLE = """\
Software Engineer
Acme Corp
Jan 2022 – Mar 2024
Built distributed systems
Led team of 5

Product Manager
StartupXYZ
Jun 2020 – Dec 2021
Defined product roadmap
"""


def test_extracts_two_entries():
    entries = extract_experience(SAMPLE)
    assert len(entries) == 2


def test_first_entry_dates():
    entries = extract_experience(SAMPLE)
    assert "2022" in entries[0].start_date
    assert "2024" in entries[0].end_date
    assert entries[0].is_current is False


def test_present_sets_is_current():
    text = "Engineer\nAcme\n2023 – Present\nDid stuff"
    entries = extract_experience(text)
    assert entries[0].is_current is True
    assert entries[0].end_date == "Present"


def test_description_captured():
    entries = extract_experience(SAMPLE)
    assert "distributed" in entries[0].description


def test_empty_section_returns_empty_list():
    assert extract_experience("") == []
