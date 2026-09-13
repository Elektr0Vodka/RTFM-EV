from app.services.unfurl import parse_link_preview


def test_parses_opengraph():
    html = """
    <html><head>
      <meta property="og:title" content="OG Title">
      <meta property="og:description" content="OG Desc">
      <meta property="og:image" content="https://cdn.example.com/i.png">
      <meta property="og:site_name" content="Example">
      <title>Fallback Title</title>
    </head><body>x</body></html>
    """
    preview = parse_link_preview(html, "https://example.com/p")
    assert preview.title == "OG Title"
    assert preview.description == "OG Desc"
    assert preview.image == "https://cdn.example.com/i.png"
    assert preview.site_name == "Example"


def test_falls_back_to_title_tag():
    html = "<html><head><title>Just A Title</title></head><body>x</body></html>"
    preview = parse_link_preview(html, "https://example.com/p")
    assert preview.title == "Just A Title"
    assert preview.description is None
    assert preview.image is None


def test_twitter_card_fallback():
    html = """
    <html><head>
      <meta name="twitter:title" content="Tw Title">
      <meta name="twitter:image" content="https://cdn.example.com/t.png">
    </head><body>x</body></html>
    """
    preview = parse_link_preview(html, "https://example.com/p")
    assert preview.title == "Tw Title"
    assert preview.image == "https://cdn.example.com/t.png"


def test_empty_when_no_metadata():
    preview = parse_link_preview("<html><body>nothing</body></html>", "https://example.com/p")
    assert preview.title is None
    assert preview.is_empty()
