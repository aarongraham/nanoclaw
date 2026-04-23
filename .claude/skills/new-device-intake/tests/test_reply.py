from lib import reply as R


# --- classify_intent ---

def test_classify_skip_simple():
    assert R.classify_intent("skip") == "skip"


def test_classify_skip_with_reason():
    assert R.classify_intent("skip, not sure yet") == "skip"


def test_classify_not_now():
    assert R.classify_intent("not now") == "skip"


def test_classify_ignore():
    assert R.classify_intent("ignore") == "ignore"


def test_classify_not_mine():
    assert R.classify_intent("not mine") == "ignore"


def test_classify_label_with_name_and_group():
    assert R.classify_intent("Fleur's iPhone, ad blocking") == "label"


def test_classify_empty_string_is_ambiguous():
    assert R.classify_intent("") == "ambiguous"


def test_classify_garbage_single_word_is_ambiguous():
    assert R.classify_intent("lol") == "ambiguous"


def test_classify_whitespace_only_is_ambiguous():
    assert R.classify_intent("   ") == "ambiguous"


# --- resolve_group ---

def test_group_ad_blocking_aliases():
    assert R.resolve_group("ad blocking") == 1
    assert R.resolve_group("block ads") == 1
    assert R.resolve_group("personal") == 1
    assert R.resolve_group("ads") == 1


def test_group_iot_aliases():
    assert R.resolve_group("iot") == 2
    assert R.resolve_group("IOT Blocked") == 2
    assert R.resolve_group("smart home") == 2


def test_group_unrestricted_aliases():
    assert R.resolve_group("unrestricted") == 3
    assert R.resolve_group("don't block") == 3
    assert R.resolve_group("allow all") == 3
    assert R.resolve_group("bypass") == 3


def test_group_default_aliases():
    assert R.resolve_group("default") == 0
    assert R.resolve_group("no blocking") == 0


def test_group_extracted_from_longer_phrase():
    assert R.resolve_group("Fleur's iPhone, ad blocking please") == 1


def test_group_none_when_no_alias():
    assert R.resolve_group("fleur's iphone") is None


# --- parse_label ---

def test_parse_label_name_and_group():
    result = R.parse_label("Fleur's iPhone, ad blocking")
    assert result["name"] == "fleur-iphone"
    assert result["group"] == 1
    assert result["owner"] == "Fleur"


def test_parse_label_normalizes_spaces_to_hyphens():
    result = R.parse_label("living room TV, iot")
    assert result["name"] == "living-room-tv"
    assert result["group"] == 2


def test_parse_label_missing_group_returns_none_group():
    result = R.parse_label("fleur's iphone")
    assert result["name"] == "fleur-iphone"
    assert result["group"] is None


def test_parse_label_missing_name_returns_empty():
    result = R.parse_label("ad blocking")
    assert result["name"] == ""
    assert result["group"] == 1


def test_parse_label_strips_possessive_for_name_but_keeps_owner():
    result = R.parse_label("Jade's new laptop, personal")
    assert result["name"] == "jade-new-laptop"
    assert result["owner"] == "Jade"
    assert result["group"] == 1


def test_parse_label_no_possessive_means_no_owner():
    result = R.parse_label("ring garden, iot")
    assert result["name"] == "ring-garden"
    assert result["owner"] == ""
    assert result["group"] == 2
