"""Tests for the fleet config document rules (plan 32, Phase 1): no database, no vault."""

import json

import pytest

from app.services import fleet_config as fc
from tests.fleet_config_samples import (
    TOOLBOX_SECRETS,
    clone,
    companion_file,
    keypair,
    secret_values,
    toolbox_file,
)

ASSET = {"label": "Mast 7", "org_serial": "DTIS-0042", "site_name": None}


def _stored(document, private_key=None):
    """Split, then pretend the vault stored every secret under ids 1, 2, 3..."""
    stored, found = fc.split_secrets(document)
    values = {}
    for secret_id, secret in enumerate(found, start=1):
        fc.set_placeholder(stored, secret.path, secret_id, encoded=secret.encoded)
        values[secret_id] = secret.text
    return stored, found, values


class TestDetectProfile:
    def test_vars_only_is_stock(self):
        assert fc.detect_profile(toolbox_file(sections=False)) == "stock"

    def test_a_region_section_alone_is_still_stock(self):
        document = toolbox_file(sections=False)
        document["region"] = {"def": "nl", "home": "nl", "default": ""}
        assert fc.detect_profile(document) == "stock"

    def test_a_filter_section_is_the_dmc_repeater(self):
        document = toolbox_file(sections=False)
        document["filter"] = {"enabled": False}
        assert fc.detect_profile(document) == "dmc_repeater"

    def test_an_mqtt_section_is_the_dmc_observer(self):
        assert fc.detect_profile(toolbox_file()) == "dmc_observer"

    def test_the_radio_settings_file_is_companion_v1(self):
        assert fc.detect_profile(companion_file()) == "companion_v1"

    @pytest.mark.parametrize(
        "document",
        [
            {},
            {"vars": "nope"},
            {"vars": {}, "mqtt": []},
            {"vars": {}, "mqtt": {"slots": {}}},
            {"version": 2, "name": "x", "radio": {"freq": 869.6}},
            {"version": 1, "name": "x"},
            {"something": "else"},
        ],
    )
    def test_anything_else_is_refused(self, document):
        with pytest.raises(fc.ConfigError):
            fc.detect_profile(document)

    def test_a_profile_only_fits_its_own_file_format(self):
        assert fc.profile_fits("stock", toolbox_file())
        assert fc.profile_fits("dmc_observer", toolbox_file(sections=False))
        assert not fc.profile_fits("companion_v1", toolbox_file())
        assert not fc.profile_fits("stock", companion_file())
        assert fc.profile_fits("companion_v1", companion_file())


class TestSplitSecrets:
    def test_every_known_secret_leaves_the_document(self):
        private_key, _public = keypair()
        document = toolbox_file(private_key)

        stored, found = fc.split_secrets(document)

        text = json.dumps(stored)
        for value in secret_values(document, private_key):
            assert value not in text
        assert {fc.path_label(secret.path): secret.text for secret in found} == {
            **TOOLBOX_SECRETS,
            "vars/prv.key": private_key,
        }
        assert stored["vars"]["prv.key"] == {"$secret": None}
        assert stored["mqtt"]["slots"][0]["token"] == {"$secret": None}

    def test_the_input_is_not_changed(self):
        document = toolbox_file()
        before = clone(document)
        fc.split_secrets(document)
        assert document == before

    def test_what_is_not_a_secret_stays_as_it_was(self):
        document = toolbox_file()
        stored, _found = fc.split_secrets(document)

        assert stored["vars"]["radio"] == document["vars"]["radio"]
        assert stored["vars"]["owner.info"] == "line one\nline two"
        assert stored["filter"] == document["filter"]
        assert stored["region"] == document["region"]
        # The owner is a public key in the firmware, so it is not hidden.
        assert stored["mqtt"]["owner"] == document["mqtt"]["owner"]
        assert list(stored) == list(document)
        assert list(stored["vars"]) == list(document["vars"])

    def test_an_empty_secret_is_not_a_secret(self):
        stored, found = fc.split_secrets(toolbox_file())

        assert stored["mqtt"]["slots"][2]["password"] == ""
        assert all("slots/2" not in fc.path_label(secret.path) for secret in found)

    def test_secret_kinds_match_the_vault(self):
        private_key, _public = keypair()
        _stored_doc, found = fc.split_secrets(toolbox_file(private_key))

        kinds = {fc.path_label(secret.path): secret.kind for secret in found}
        assert kinds["vars/prv.key"] == "private_key"
        assert kinds["vars/guest.password"] == "guest_password"
        assert kinds["mqtt/wifiPassword"] == "wifi"
        assert kinds["mqtt/alertPsk"] == "other"

    def test_a_numeric_password_keeps_its_type(self):
        # The toolbox turns an all-digit reply into a number.
        document = toolbox_file(sections=False)
        document["vars"]["guest.password"] = 12345

        stored, found, values = _stored(document)

        assert "12345" not in json.dumps(stored)
        assert found[0].encoded is True
        exported, included, left_out = fc.export_document(stored, values)
        assert exported["vars"]["guest.password"] == 12345
        assert (included, left_out) == (1, 0)

    def test_an_unknown_key_that_looks_like_a_secret_is_hidden_too(self):
        document = toolbox_file()
        document["mqtt"]["newBrokerToken"] = "tok-123"
        document["vars"]["future.setting"] = "plain"
        document["extra"] = {"apiPassword": "pw-456", "tokenCount": 4}

        stored, found = fc.split_secrets(document)

        labels = {fc.path_label(secret.path) for secret in found}
        assert {"mqtt/newBrokerToken", "extra/apiPassword"} <= labels
        assert stored["vars"]["future.setting"] == "plain"
        # Only text is guessed at: a number under such a name is kept.
        assert stored["extra"]["tokenCount"] == 4

    def test_the_companion_private_key_is_a_secret(self):
        private_key, _public = keypair()
        stored, found = fc.split_secrets(companion_file(private_key))

        assert private_key not in json.dumps(stored)
        assert [(fc.path_label(s.path), s.kind) for s in found] == [("private_key", "private_key")]
        assert stored["name"] == "My Companion"

    def test_a_file_that_already_holds_a_placeholder_is_refused(self):
        document = toolbox_file()
        document["vars"]["guest.password"] = {"$secret": 7}

        with pytest.raises(fc.ConfigError):
            fc.split_secrets(document)

    def test_a_document_nested_too_deep_is_refused(self):
        document = toolbox_file(sections=False)
        nested: dict = {}
        document["deep"] = nested
        for _ in range(40):
            nested["x"] = {}
            nested = nested["x"]

        with pytest.raises(fc.ConfigError):
            fc.split_secrets(document)


class TestExport:
    def test_with_the_secrets_the_file_is_the_one_that_was_imported(self):
        private_key, _public = keypair()
        document = toolbox_file(private_key)
        stored, _found, values = _stored(document)

        exported, included, left_out = fc.export_document(stored, values)

        assert exported == document
        assert json.dumps(exported) == json.dumps(document)  # same key order too
        assert (included, left_out) == (len(values), 0)

    def test_without_the_secrets_those_keys_are_left_out(self):
        private_key, _public = keypair()
        document = toolbox_file(private_key)
        stored, _found, values = _stored(document)

        exported, included, left_out = fc.export_document(stored, None)

        assert (included, left_out) == (0, len(values))
        assert "prv.key" not in exported["vars"]
        assert "guest.password" not in exported["vars"]
        assert "wifiPassword" not in exported["mqtt"]
        assert "token" not in exported["mqtt"]["slots"][0]
        assert exported["mqtt"]["slots"][0]["server"] == "mqtt.example.org"
        assert "$secret" not in json.dumps(exported)

    def test_a_secret_that_was_never_stored_is_left_out_and_counted(self):
        document = toolbox_file(sections=False)
        stored, _found = fc.split_secrets(document)  # nothing stored: all null

        exported, included, left_out = fc.export_document(stored, {})

        assert (included, left_out) == (0, 1)
        assert "guest.password" not in exported["vars"]

    def test_a_secret_missing_from_the_vault_is_left_out_and_counted(self):
        document = toolbox_file()
        stored, _found, values = _stored(document)
        gone = next(iter(values))
        del values[gone]

        exported, included, left_out = fc.export_document(stored, values)

        assert left_out == 1
        assert included == len(values)
        assert "$secret" not in json.dumps(exported)

    def test_placeholder_counts(self):
        stored, _found, _values = _stored(toolbox_file())
        stored["vars"]["guest.password"] = {"$secret": None}

        assert fc.count_placeholders(stored) == (len(TOOLBOX_SECRETS) - 1, 1)
        assert sorted(fc.secret_ids(stored)) == list(range(2, len(TOOLBOX_SECRETS) + 1))


class TestTemplateFromConfig:
    def test_identity_and_secrets_are_stripped(self):
        private_key, _public = keypair()
        stored, _found, _values = _stored(toolbox_file(private_key))

        template = fc.template_document(stored)

        for key in ("name", "lat", "lon"):
            assert key not in template["vars"]
        assert template["vars"]["prv.key"] == {"$secret": None}
        assert template["mqtt"]["wifiPassword"] == {"$secret": None}
        assert fc.secret_ids(template) == []
        assert template["vars"]["tx"] == 22
        assert template["mqtt"]["wifiSsid"] == "mesh-lab"

    def test_companion_identity_is_stripped(self):
        stored, _found = fc.split_secrets(companion_file())

        template = fc.template_document(stored)

        for key in ("name", "lat", "lon", "exported_at"):
            assert key not in template
        assert template["version"] == 1
        assert template["radio"] == {"freq": 869.618, "bw": 62.5, "sf": 8, "cr": 8}


def _variables(*items):
    return [
        {"name": name, "description": "", "default": default, "type": kind}
        for name, kind, default in items
    ]


class TestValidateTemplate:
    def test_a_template_made_from_a_config_is_valid(self):
        stored, _found = fc.split_secrets(toolbox_file())
        fc.validate_template("dmc_observer", fc.template_document(stored), [])

    def test_variables_must_be_declared(self):
        document = {"vars": {"name": "{{site}}-{{asset.label}}"}}

        with pytest.raises(fc.ConfigError, match="site"):
            fc.validate_template("stock", document, [])
        fc.validate_template("stock", document, _variables(("site", "text", "")))

    def test_an_unknown_asset_variable_is_refused(self):
        with pytest.raises(fc.ConfigError, match="asset.owner"):
            fc.validate_template("stock", {"vars": {"name": "{{asset.owner}}"}}, [])

    @pytest.mark.parametrize("value", ["hunter2", "{{guest_pw}}", {"$secret": 3}])
    def test_a_template_never_holds_a_secret(self, value):
        document = {"vars": {"guest.password": value}}
        variables = _variables(("guest_pw", "text", ""))

        with pytest.raises(fc.ConfigError):
            fc.validate_template("stock", document, variables)

    def test_an_empty_secret_and_a_placeholder_are_fine(self):
        document = {"vars": {"guest.password": "", "prv.key": {"$secret": None}}}
        fc.validate_template("stock", document, [])

    @pytest.mark.parametrize(
        "variables",
        [
            _variables(("1bad", "text", "")),
            _variables(("asset.label", "text", "")),
            _variables(("twice", "text", ""), ("twice", "text", "")),
            _variables(("count", "number", "many")),
            _variables(("flag", "boolean", "maybe")),
            [{"name": "kind", "description": "", "default": "", "type": "date"}],
        ],
    )
    def test_bad_variables_are_refused(self, variables):
        with pytest.raises(fc.ConfigError):
            fc.validate_template("stock", {"vars": {}}, variables)

    def test_the_document_must_fit_the_profile(self):
        with pytest.raises(fc.ConfigError):
            fc.validate_template("companion_v1", {"vars": {}}, [])
        with pytest.raises(fc.ConfigError):
            fc.validate_template("stock", {"version": 1, "radio": {}}, [])
        fc.validate_template("companion_v1", {"version": 1, "radio": {}}, [])


class TestRenderTemplate:
    def test_asset_fields_and_variables_are_filled_in(self):
        document = {
            "vars": {
                "name": "{{asset.label}} ({{asset.org_serial}})",
                "lat": "{{lat}}",
                "repeat": "{{repeat}}",
                "owner.info": "Site {{site}}",
                "tx": 22,
                "guest.password": {"$secret": None},
            }
        }
        variables = _variables(
            ("lat", "number", ""), ("repeat", "boolean", "true"), ("site", "text", "unknown")
        )

        rendered = fc.render_template(document, variables, {"lat": "52.5", "site": "North"}, ASSET)

        assert rendered["vars"] == {
            "name": "Mast 7 (DTIS-0042)",
            "lat": 52.5,
            "repeat": True,
            "owner.info": "Site North",
            "tx": 22,
            "guest.password": {"$secret": None},
        }

    def test_a_whole_number_stays_an_integer(self):
        rendered = fc.render_template(
            {"vars": {"tx": "{{power}}", "name": "p{{power}}"}},
            _variables(("power", "number", "20")),
            {},
            ASSET,
        )
        assert rendered["vars"] == {"tx": 20, "name": "p20"}
        assert isinstance(rendered["vars"]["tx"], int)

    def test_the_template_is_not_changed(self):
        document = {"vars": {"name": "{{asset.label}}"}}
        fc.render_template(document, [], {}, ASSET)
        assert document == {"vars": {"name": "{{asset.label}}"}}

    def test_a_missing_value_names_the_variable(self):
        document = {"vars": {"name": "{{site}}", "lat": "{{lat}}"}}
        variables = _variables(("site", "text", ""), ("lat", "number", ""))

        with pytest.raises(fc.ConfigError, match="lat"):
            fc.render_template(document, variables, {"site": "x"}, ASSET)

    def test_an_asset_field_that_is_empty_is_named(self):
        with pytest.raises(fc.ConfigError, match="asset.site_name"):
            fc.render_template({"vars": {"name": "{{asset.site_name}}"}}, [], {}, ASSET)

    def test_a_value_of_the_wrong_type_is_refused(self):
        with pytest.raises(fc.ConfigError, match="lat"):
            fc.render_template(
                {"vars": {"lat": "{{lat}}"}}, _variables(("lat", "number", "")), {"lat": "x"}, ASSET
            )

    def test_an_empty_text_default_is_a_value(self):
        rendered = fc.render_template(
            {"vars": {"owner.info": "{{info}}"}}, _variables(("info", "text", "")), {}, ASSET
        )
        assert rendered["vars"]["owner.info"] == ""
