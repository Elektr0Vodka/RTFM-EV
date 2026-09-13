import socket

import pytest

from app.services.url_safety import UnsafeUrlError, assert_public_http_url, resolve_public_ip


def test_rejects_non_http_scheme():
    with pytest.raises(UnsafeUrlError):
        assert_public_http_url("ftp://example.com/x")
    with pytest.raises(UnsafeUrlError):
        assert_public_http_url("file:///etc/passwd")


def test_rejects_missing_host():
    with pytest.raises(UnsafeUrlError):
        assert_public_http_url("http:///nohost")


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/x",
        "http://localhost/x",
        "http://169.254.169.254/latest/meta-data",  # link-local (cloud metadata)
        "http://10.0.0.5/x",
        "http://192.168.1.1/x",
        "http://[::1]/x",
    ],
)
def test_rejects_private_and_loopback(url, monkeypatch):
    def fake_getaddrinfo(host, *args, **kwargs):
        mapping = {
            "localhost": "127.0.0.1",
            "127.0.0.1": "127.0.0.1",
            "169.254.169.254": "169.254.169.254",
            "10.0.0.5": "10.0.0.5",
            "192.168.1.1": "192.168.1.1",
            "::1": "::1",
        }
        ip = mapping.get(host, host)
        family = socket.AF_INET6 if ":" in ip else socket.AF_INET
        return [(family, socket.SOCK_STREAM, 0, "", (ip, 0))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(UnsafeUrlError):
        assert_public_http_url(url)


def test_allows_public_host(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.216.34", 0))],
    )
    # Should not raise.
    assert_public_http_url("https://example.com/page")


def test_resolve_public_ip_returns_validated_ip(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.216.34", 0))],
    )
    assert resolve_public_ip("https://example.com/page") == "93.184.216.34"


def test_resolve_public_ip_rejects_private(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("10.0.0.5", 0))],
    )
    with pytest.raises(UnsafeUrlError):
        resolve_public_ip("http://internal.example/x")
