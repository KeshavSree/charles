"""Ingest filter keyword matching.

The location filter shipped without the acronym rule that the title filter had,
so a US-only allow list of ["US", "CA", "NC", "TX"] admitted 51% of a real scan
on substring accidents. These tests pin the rule in both filters.
"""
import pytest

from scanner.filters.keywords import compile_keyword, normalize_keyword_list
from scanner.filters.location import build_location_filter, is_unspecified
from scanner.filters.title import build_title_filter

US_ONLY = {
    "allow": ["US", "United States", "USA", "New York", "Austin", "California",
              "Seattle", "Raleigh", "North Carolina", "NC", "CA", "TX"]
}


@pytest.mark.parametrize("location", [
    "San Diego, CA",
    "Austin, TX",
    "Chicago, IL, USA",
    "Apex, NC",
    "Seattle, WA",
    "United States-Florida-Melbourne",
])
def test_real_us_locations_pass(location):
    assert build_location_filter(US_ONLY)(location) is True


@pytest.mark.parametrize("location,accident", [
    ("Toronto, ON, CAN", "ca"),
    ("Toronto, Ontario, Canada", "ca"),
    ("Viana do Castelo II - Portugal", "ca"),
    ("Netherlands-Remote Location-Middelburg", "ca"),
    ("Richmond, BC, Canada", "ca"),
    ("Annapolis Junction, MD", "nc"),
    ("Building 400-Whippany Campus, Jefferson Park", "us"),
    ("SLA-REVENUE HOUSE LEVEL 11", "us"),
])
def test_two_letter_codes_do_not_match_inside_words(location, accident):
    """Each of these was stored by a real scan because a state code appeared as a
    substring of an ordinary word."""
    assert accident in location.lower()          # the accident is really there
    assert build_location_filter(US_ONLY)(location) is False


@pytest.mark.parametrize("placeholder", ["2 Locations", "66 Locations", "1 Location", ""])
def test_workday_multi_location_placeholder_counts_as_unknown(placeholder):
    """Workday names a count instead of the offices. That is absent data, not a
    place, and an unknown location passes the same way a blank one does."""
    assert is_unspecified(placeholder) is True
    assert build_location_filter(US_ONLY)(placeholder) is True


def test_blocklist_also_respects_word_boundaries():
    f = build_location_filter({"allow": [], "block": ["CA"]})
    assert f("San Jose, CA") is False
    assert f("Kansas City, MO") is True      # "Kansas" contains "ca"? no -- "Kan-sas"
    assert f("Lancaster, PA") is True        # "Lan-ca-ster" would have matched as substring


def test_always_allow_beats_block():
    f = build_location_filter({"allow": [], "always_allow": ["US"], "block": ["India"]})
    assert f("Remote, US or India") is True
    assert f("Remote, India") is False


def test_empty_allow_is_a_pure_blocklist():
    f = build_location_filter({"allow": [], "block": ["India"]})
    assert f("Anywhere on earth") is True
    assert f("Bengaluru, India") is False


def test_title_acronyms_stay_word_bounded():
    f = build_title_filter({"positive": ["ml", "ai", "software"]})
    assert f("ML Engineer") is True
    assert f("AI Researcher") is True
    assert f("HTML Developer") is False       # "ht-ml"
    assert f("Retail Associate") is False     # "ret-ai-l"


def test_longer_keywords_keep_substring_matching():
    assert compile_keyword("engineer")("staff engineering manager") is True
    assert compile_keyword(".net")("senior .net developer") is True


def test_empty_keywords_are_dropped_not_matched_as_everything():
    """A blank entry would match every string via `in` and silently disable the filter."""
    assert normalize_keyword_list(["", "  ", "CA", None, 7]) == ["ca"]
