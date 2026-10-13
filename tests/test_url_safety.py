import socket

import pytest

from app.services.url_safety import (
    UnresolvedHostError,
    UnsafeUrlError,
    assert_public_http_url,
    resolve_public_ip,
)


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


def _resolves_to(monkeypatch, ip: str) -> None:
    family = socket.AF_INET6 if ":" in ip else socket.AF_INET
    monkeypatch.setattr(
        socket, "getaddrinfo", lambda *a, **k: [(family, socket.SOCK_STREAM, 0, "", (ip, 0))]
    )


@pytest.mark.parametrize(
    "ip",
    [
        "100.64.0.1",  # shared address space: carrier NAT, overlay networks
        "100.127.255.254",
        "198.18.0.1",  # benchmarking
        "192.0.2.10",  # documentation
        "::ffff:10.0.0.5",  # a private address behind an IPv4-mapped one
        "::ffff:100.64.0.1",
        "2001:db8::1",  # documentation
    ],
)
def test_rejects_addresses_that_are_not_on_the_public_internet(ip, monkeypatch):
    _resolves_to(monkeypatch, ip)
    with pytest.raises(UnsafeUrlError):
        resolve_public_ip("https://example.com/x")


@pytest.mark.parametrize("ip", ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"])
def test_allows_public_addresses(ip, monkeypatch):
    _resolves_to(monkeypatch, ip)
    assert resolve_public_ip("https://example.com/x") == ip


def test_a_name_without_an_address_is_not_called_unsafe(monkeypatch):
    def no_such_host(*args, **kwargs):
        raise socket.gaierror("Name or service not known")

    monkeypatch.setattr(socket, "getaddrinfo", no_such_host)
    with pytest.raises(UnresolvedHostError):
        resolve_public_ip("https://no-such-host.example/x")
    # Still refused by code that only knows the general error.
    with pytest.raises(UnsafeUrlError):
        resolve_public_ip("https://no-such-host.example/x")


def test_rejects_site_local_ipv6(monkeypatch):
    _resolves_to(monkeypatch, "fec0::1")
    with pytest.raises(UnsafeUrlError):
        resolve_public_ip("https://example.com/x")
