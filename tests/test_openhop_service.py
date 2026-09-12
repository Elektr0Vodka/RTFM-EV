from app.services.openhop import is_openhop


class TestIsOpenHop:
    def test_detects_openhop_repeater_companion(self):
        assert is_openhop("openHop-Repeater-Companion") is True

    def test_case_insensitive_and_whitespace(self):
        assert is_openhop("  OPENHOP-Something ") is True

    def test_non_openhop_model(self):
        assert is_openhop("Heltec V3") is False

    def test_none(self):
        assert is_openhop(None) is False

    def test_empty(self):
        assert is_openhop("") is False
