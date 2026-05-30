from parser.contact import extract_contact


def test_extracts_email():
    text = "Jane Smith\njane.smith@example.com\n(415) 555-0100"
    info = extract_contact(text)
    assert info.email == "jane.smith@example.com"


def test_extracts_phone():
    text = "Jane Smith\njane@example.com\n(415) 555-0100"
    info = extract_contact(text)
    assert info.phone == "(415) 555-0100"


def test_extracts_linkedin():
    text = "Jane Smith\njane@example.com\nhttps://linkedin.com/in/janesmith"
    info = extract_contact(text)
    assert info.linkedin_url == "https://linkedin.com/in/janesmith"


def test_extracts_location():
    text = "Jane Smith\njane@example.com | San Francisco, CA"
    info = extract_contact(text)
    assert info.location == "San Francisco, CA"


def test_extracts_name_from_first_line():
    text = "Jane Smith\njane@example.com"
    info = extract_contact(text)
    assert info.first_name == "Jane"
    assert info.last_name == "Smith"


def test_contact_section_searched_first():
    full_text = "Jane Smith\nother@other.com"
    contact_section = "jane@example.com\n(415) 555-0100"
    info = extract_contact(full_text, contact_section=contact_section)
    assert info.email == "jane@example.com"


def test_missing_fields_are_empty_string():
    info = extract_contact("No contact info here at all")
    assert info.email == ""
    assert info.phone == ""
    assert info.linkedin_url == ""
