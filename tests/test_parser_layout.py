"""Layout-aware parsing.

Tests build `Line` objects directly rather than round-tripping a PDF: the PDF
reader's only job is to produce these, and every failure this rewrite targets
(entry boundaries, column labelling) lives downstream of them.
"""
from parser.entries import contact_from_header, education_from_section, experience_from_section
from parser.layout import Line
from parser.structure import parse_document

BODY, ENTRY, HEADING, NAME = 11.0, 12.0, 14.3, 24.0


def line(*columns, size=BODY, bold=False, italic=False, bullet=False, x0=47.0):
    return Line(
        columns=list(columns), size=size, bold=bold, italic=italic,
        bullet=bullet, x0=x0, top=line.top, page=0,
    )


line.top = 0.0


def build(*specs):
    """Assign increasing `top` values so lines keep their declared order."""
    out = []
    for i, spec in enumerate(specs):
        line.top = float(i * 20)
        out.append(spec())
    return out


RESUME = lambda: build(  # noqa: E731
    lambda: line("Keshav Sreekantham", size=NAME, bold=True),
    lambda: line("(512)-803-0327 | ksreekan@purdue.edu | linkedin.com/in/ksreekan | github.com/KeshavSree"),
    lambda: line("Education", size=HEADING),
    lambda: line("Purdue University", "West Lafayette, IN", size=ENTRY, bold=True),
    lambda: line("B.S. Data Science (Computer Science)", "December 2027 |GPA: 3.69", italic=True),
    lambda: line("Relevant Coursework: Data Structures & Algorithms,", bullet=True, x0=73.0),
    lambda: line("Numerical Methods", x0=73.0),
    lambda: line("Experience", size=HEADING),
    lambda: line("Software Developer", "January 2025 – Current", size=ENTRY, bold=True),
    lambda: line("KiharaLab", "West Lafayette, IN", italic=True),
    lambda: line("Integrated modern sequence alignment tools, enabling 4x", bullet=True, x0=73.0),
    lambda: line("faster sequence alignment queries.", x0=73.0),
    lambda: line("Refactored the annotation tool code base.", bullet=True, x0=73.0),
    lambda: line("Software Engineering Intern", "June 2025 – August 2025", size=ENTRY, bold=True),
    lambda: line("Spring Education Group", "Austin, TX", italic=True),
    lambda: line("Built an analytics dashboard.", bullet=True, x0=73.0),
)


def parsed():
    header, sections = parse_document(RESUME())
    return header, {s.name: s for s in sections}


def test_sections_split_on_the_heading_font_tier():
    header, sections = parsed()
    assert list(sections) == ["education", "experience"]
    assert [l.left for l in header] == [
        "Keshav Sreekantham",
        "(512)-803-0327 | ksreekan@purdue.edu | linkedin.com/in/ksreekan | github.com/KeshavSree",
    ]


def test_each_entry_header_starts_a_new_entry():
    _, sections = parsed()
    assert len(sections["experience"].entries) == 2


def test_a_bullet_never_becomes_the_next_employer():
    """The flat-text parser used to read the last bullet of one job as the next
    job's company, because it looked for text preceding a date range."""
    _, sections = parsed()
    companies = [e.company for e in experience_from_section(sections["experience"])]
    assert companies == ["KiharaLab", "Spring Education Group"]


def test_company_and_location_stay_in_separate_fields():
    _, sections = parsed()
    first = experience_from_section(sections["experience"])[0]
    assert first.company == "KiharaLab"
    assert first.location == "West Lafayette, IN"
    assert first.title == "Software Developer"


def test_dates_are_normalized_to_mm_yyyy():
    """The profile editor validates MM/YYYY and the extension's parseDateParts
    splits on "/", so prose dates have to be converted here, not displayed raw."""
    _, sections = parsed()
    first, second = experience_from_section(sections["experience"])
    assert (first.start_date, first.end_date, first.is_current) == ("01/2025", "", True)
    assert (second.start_date, second.end_date, second.is_current) == ("06/2025", "08/2025", False)


def test_wrapped_bullet_is_joined_not_split():
    _, sections = parsed()
    first = experience_from_section(sections["experience"])[0]
    assert "enabling 4x faster sequence alignment queries." in first.description
    assert len(first.description.splitlines()) == 2


def test_title_and_company_order_is_inferred_not_assumed():
    """Templates disagree on which comes first; vocabulary decides."""
    header, sections = parse_document(build(
        lambda: line("Experience", size=HEADING),
        lambda: line("Acme Technologies", "January 2025 – Current", size=ENTRY, bold=True),
        lambda: line("Backend Engineer", "Austin, TX", italic=True),
    ))
    entry = experience_from_section(sections[0])[0]
    assert entry.company == "Acme Technologies"
    assert entry.title == "Backend Engineer"


def test_education_fields():
    _, sections = parsed()
    edu = education_from_section(sections["education"])[0]
    assert edu.institution == "Purdue University"
    assert edu.degree == "B.S."
    assert edu.major == "Data Science (Computer Science)"
    assert edu.gpa == "3.69"
    assert (edu.grad_month, edu.grad_year) == ("December", "2027")


def test_contact_comes_from_the_header_only():
    header, sections = parsed()
    c = contact_from_header(header, list(sections.values()))
    assert (c.first_name, c.last_name) == ("Keshav", "Sreekantham")
    assert c.email == "ksreekan@purdue.edu"
    assert c.phone == "(512)-803-0327"
    assert c.linkedin_url == "linkedin.com/in/ksreekan"
    assert c.github_url == "github.com/KeshavSree"
    # linkedin.com must not be re-matched mid-host as a personal site.
    assert c.website == ""


def test_location_falls_back_to_the_current_role():
    header, sections = parsed()
    c = contact_from_header(header, list(sections.values()))
    assert c.location == "West Lafayette, IN"


def test_headings_set_at_body_size_are_found_by_weight_and_case():
    """Plenty of templates separate sections with bold ALL CAPS at body size."""
    _, sections = parse_document(build(
        lambda: line("KESHAV SREEKANTHAM", size=NAME, bold=True),
        lambda: line("EDUCATION", bold=True),
        lambda: line("Purdue University", "May 2027"),
        lambda: line("EXPERIENCE", bold=True),
        lambda: line("Undergraduate Researcher", "2025 – Present"),
    ))
    assert [s.name for s in sections] == ["education", "experience"]


def test_unknown_headings_are_kept_as_their_own_section():
    _, sections = parse_document(build(
        lambda: line("Education", size=HEADING),
        lambda: line("Purdue University", "May 2027", size=ENTRY, bold=True),
        lambda: line("Current Research", size=HEADING),
        lambda: line("Peptide annotation.", bullet=True, x0=73.0),
    ))
    assert [s.name for s in sections] == ["education", "current_research"]


def test_year_only_ranges_span_the_whole_years():
    """"2022 - 2024" means the start of 2022 to the end of 2024, so the two
    endpoints resolve the missing month in opposite directions."""
    _, sections = parse_document(build(
        lambda: line("Experience", size=HEADING),
        lambda: line("Research Assistant", "2022 – 2024", size=ENTRY, bold=True),
        lambda: line("Purdue University", "West Lafayette, IN", italic=True),
        lambda: line("Ran experiments and wrote up the results for publication.", bullet=True, x0=73.0),
    ))
    entry = experience_from_section(sections[0])[0]
    assert (entry.start_date, entry.end_date) == ("01/2022", "12/2024")


def test_term_dates_resolve_to_months():
    _, sections = parse_document(build(
        lambda: line("Experience", size=HEADING),
        lambda: line("Payload Design Engineer", "Summer 2023 – Fall 2023", size=ENTRY, bold=True),
        lambda: line("Rice University", "Houston, TX", italic=True),
        lambda: line("Led a team of engineers designing a high-altitude payload.", bullet=True, x0=73.0),
    ))
    entry = experience_from_section(sections[0])[0]
    assert (entry.start_date, entry.end_date) == ("05/2023", "12/2023")
