"""A simulated spam attack on a busy mesh, judged by both forwarding engines.

Six hours of ordinary chat by regulars, then three hours in which the chat
goes on and several kinds of spam attack overlap. Every message is judged by
the rules Spam Guard has in force at that moment:

- OpenHop forwards a packet before RTFM-EV sees it, so it is judged by the
  rules rendered before the message is ingested (``NodePolicy``, the port of
  OpenHop's policy engine, on a real encrypted GRP_TXT frame).
- The host repeater judges a frame after Spam Guard has seen it, so it is
  judged after ``ingest`` and ``decide(rematch=...)`` (``evaluate_layers``).

Names, texts and scenarios are our own. Deterministic for a given seed.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from app.services.host_repeater_policy import evaluate_layers
from app.services.host_repeater_settings import PolicyConfig, PolicyRule
from app.services.policy_verdict import NodePolicy
from app.spam.detector import SpamDetector
from app.spam.rules import OPENHOP_BOT_SENDERS, OPENHOP_KNOWN_SENDERS, OPENHOP_OBJECT_GROUP, render
from app.spam.settings import SpamConfig
from tests.test_policy_verdict import group_text
from tests.test_spam_rules import fields

PUBLIC = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
START = 1_800_000_000.0
CHAT_SECONDS = 6 * 3600
ATTACK_SECONDS = 3 * 3600
# Measured, but not part of the gate: a regular's name copied by a spammer on
# another repeater. Spam Guard never blocks a name, so only its text can stop it.
EXCLUDED_KINDS = frozenset({"copied_name"})

REGULARS = [
    "Anouk", "Bram", "Daan", "Eva", "Femke", "Gert", "Hanna", "Ilse", "Joost", "Karin",
    "Lars", "Maaike", "Niels", "Olga", "Pim", "Quinten", "Roos", "Sven", "Tess", "Ugo",
    "Vera", "Wim", "Xander", "Yara", "Zoe", "Bas de Vries", "Lotte K", "Henk 🛰",
    "MeshNL-Utrecht", "Node Haarlem", "Rik", "Sanne", "Thijs", "Mila", "Noor",
    "Jan PD0ABC", "Mike_PA3XYZ", "Ria-PE1RK", "Kees 2E0KDS", "Joop-PD2JW",
]  # fmt: skip
HOMES = ["21", "34", "47", "5A", "6C", "7E", "8D", "9B", "A4", "C3"]
ONWARD = [("B1",), ("B1", "7F"), (), ("B1",), ("6D", "B1")]
# Everyday phrases several people say, short enough to be ordinary chat.
GREETINGS = [
    "good evening mesh",
    "Goedemorgen allemaal",
    "goedenavond iedereen",
    "73",
    "ok",
    "👍",
    "test",
    "lol",
]
# Longer chat is put together from parts, so two people rarely send the same sentence.
OPENERS = [
    "just checked",
    "today I moved",
    "my neighbour asked about",
    "finally fixed",
    "still testing",
    "thinking about upgrading",
    "anyone else seeing trouble with",
    "had a look at",
    "measured",
    "rebuilt",
    "swapped",
    "repainted",
    "spent the evening on",
    "lost contact with",
    "found the fault in",
    "ordered parts for",
    "took down",
    "put back",
    "reflashed",
    "cleaned up",
]
TOPICS = [
    "the antenna on the shed",
    "the node near the canal",
    "my solar panel",
    "the repeater at the station",
    "the new firmware",
    "the battery pack",
    "my car node",
    "the link to the city",
    "the roof mount",
    "the handheld",
    "the backup node",
    "the advert interval",
    "the coax run",
    "the enclosure",
    "the mast in the garden",
    "the node at work",
    "the spare radio",
    "the GPS module",
    "the charger",
    "my test setup",
]
ENDINGS = [
    "and it works better now",
    "but range is still poor",
    "so I can reach two more hops",
    "any tips?",
    "after the storm",
    "this morning",
    "since yesterday",
    "with a new cable",
    "for the meetup",
    "again",
    "and now it is quiet",
    "no idea why",
    "thanks to the tips here",
    "will report back",
    "fingers crossed",
    "what a job",
    "took me hours",
    "cost almost nothing",
    "looks promising",
    "still not sure",
]
PLACES = [
    "Utrecht",
    "Haarlem",
    "Zwolle",
    "Gouda",
    "Leiden",
    "Delft",
    "Arnhem",
    "Breda",
    "Assen",
    "Hoorn",
]
NEW_NORMAL = [
    "Gerrit", "Monique", "Frits", "Ingrid", "Harm", "Petra", "Wouter", "Ellen", "Arjen",
    "Bianca", "Ruud", "Saskia", "Teun", "Marloes", "Koen", "Fleur", "Dirk", "Lieke",
]  # fmt: skip
PROMO = [
    "Cheap LoRa radios today only at the mesh shop, order now before stock runs out",
    "Free upgrade for your node, send your details to the admin team right away",
    "Join the new super mesh network, much faster than this one, link in bio",
]
HOMOGLYPH = [
    "Frее rаdiоs fоr еvеryоnе, cоntаct us tоdаy",  # Cyrillic а, е, о
    "Вig sаlе оn аntеnnаs, оnly this wееk",
]
SALAD = [
    "blue",
    "river",
    "seven",
    "window",
    "quick",
    "paper",
    "silver",
    "garden",
    "north",
    "candle",
    "orbit",
    "pillow",
    "tango",
    "marble",
    "velvet",
    "crisp",
    "harbor",
    "lemon",
    "rocket",
    "meadow",
]
ODD_CHARS = "ЖѬѮꙨ☙⍟⌬⏚┤╫ᦐᚱᛝჯɛꓫ৺ᵐ"
TAG_FIRST = ["Marco", "Lena", "Tomas", "Ruben", "Silke", "Arno", "Britt", "Jorrit", "Nadia"]
EMOJI = ["🔥", "💰", "🚀", "🎁", "💎", "⚡", "🍀", "🎉"]


@dataclass(frozen=True)
class Message:
    ts: float
    sender: str
    text: str
    path: tuple[str, ...]
    kind: str  # "regular", or the attack it belongs to


@dataclass
class Score:
    attack_total: int = 0
    attack_stopped: int = 0
    regular_total: int = 0
    regular_held: int = 0
    per_kind: dict[str, list[int]] = field(default_factory=dict)

    def add(self, kind: str, dropped: bool) -> None:
        seen = self.per_kind.setdefault(kind, [0, 0])
        seen[0] += 1
        seen[1] += int(dropped)
        if kind == "regular":
            self.regular_total += 1
            self.regular_held += int(dropped)
        elif kind not in EXCLUDED_KINDS:
            self.attack_total += 1
            self.attack_stopped += int(dropped)

    @property
    def stop_rate(self) -> float:
        return 100.0 * self.attack_stopped / self.attack_total if self.attack_total else 0.0

    @property
    def held_rate(self) -> float:
        return 100.0 * self.regular_held / self.regular_total if self.regular_total else 0.0


@dataclass
class Result:
    per_engine: dict[str, Score]

    def report(self) -> str:
        lines = []
        for engine, score in self.per_engine.items():
            lines.append(
                f"{engine}: stopped {score.stop_rate:.1f}% of {score.attack_total} attack messages, "
                f"held {score.held_rate:.1f}% of {score.regular_total} regular messages"
            )
            for kind, (total, dropped) in sorted(score.per_kind.items()):
                lines.append(f"  {kind:<18} {dropped:>4} / {total:<4} dropped")
        return "\n".join(lines)


def _made_up(rng: random.Random) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(rng.choice(alphabet) for _ in range(8))


def _hop(rng: random.Random, taken: set[str]) -> str:
    while True:
        hop = f"{rng.randrange(256):02X}"
        if hop not in taken:
            taken.add(hop)
            return hop


def _via(rng: random.Random, first: str) -> tuple[str, ...]:
    """A route from a far-off first repeater to ours: spam takes the routes everyone takes."""
    return (first, *rng.choice(ONWARD))


def _edit(rng: random.Random, text: str) -> str:
    """A small change a spammer makes to dodge exact matching."""
    choice = rng.randrange(4)
    if choice == 0:
        return f"{text} {rng.choice(EMOJI)}"
    if choice == 1:
        return f"{rng.choice(['Hey!', 'Hi all,', 'Attention:'])} {text}"
    if choice == 2:
        return text.replace(" ", "  ", 1)
    return text.upper() if rng.random() < 0.5 else text


def generate(seed: int = 7) -> list[Message]:
    rng = random.Random(seed)
    out: list[Message] = []
    homes = {name: (rng.choice(HOMES), *rng.choice(ONWARD)) for name in REGULARS}
    taken = set(HOMES) | {"B1", "7F", "6D"}

    # Ordinary chat for the whole nine hours, with greetings several people repeat.
    t = START
    while t < START + CHAT_SECONDS + ATTACK_SECONDS:
        t += rng.uniform(10, 40)
        name = rng.choice(REGULARS)
        if rng.random() < 0.25:
            text = rng.choice(GREETINGS)
        else:
            text = f"{rng.choice(OPENERS)} {rng.choice(TOPICS)} {rng.choice(ENDINGS)}"
            if rng.random() < 0.6:
                text += rng.choice(
                    [
                        f", {rng.randrange(2, 60)} km to {rng.choice(PLACES)}",
                        f" ({rng.randrange(-120, -60)} dBm)",
                        f", {rng.randrange(1, 9)} hops",
                        f" near {rng.choice(PLACES)}",
                    ]
                )
        if rng.random() < 0.08:
            text = f"@[{rng.choice(REGULARS)}] {text}"
        out.append(Message(t, name, text, homes[name], "regular"))
        if rng.random() < 0.03:  # nobody answered: sent once more
            out.append(Message(t + rng.uniform(60, 240), name, text, homes[name], "regular"))

    attack = START + CHAT_SECONDS

    def add(kind: str, ts: float, sender: str, text: str, path: tuple[str, ...]) -> None:
        out.append(Message(ts, sender, text, path, kind))

    # Made-up names through one repeater, one campaign text with small edits.
    hop = _hop(rng, taken)
    for i in range(40):
        add(
            "flood_one_hop",
            attack + 300 + i * 15,
            _made_up(rng),
            _edit(rng, PROMO[0]),
            _via(rng, hop),
        )

    # Made-up names through many repeaters at once, faster than per-repeater blocks.
    for burst in (attack + 1800, attack + 6000):
        hops = [_hop(rng, taken) for _ in range(10)]
        for i in range(36):
            text = " ".join(rng.choices(SALAD, k=rng.randrange(5, 10)))
            add("flood_many_hops", burst + i * 3, _made_up(rng), text, _via(rng, hops[i % 10]))

    # One spammer whose repeater changes identity, same onward route.
    for i in range(40):
        add(
            "rotating_hop",
            attack + 2400 + i * 30,
            _made_up(rng),
            _edit(rng, PROMO[1]),
            (_hop(rng, taken), "C5", "B1"),
        )

    # One new, normal-looking name repeating itself.
    for i in range(15):
        add(
            "repeating_name",
            attack + 3600 + i * 60,
            "Bobby",
            "Does anyone want to buy my old radio",
            _via(rng, rng.choice(HOMES)),
        )

    # The same promotion under new, normal-looking names.
    hop = _hop(rng, taken)
    for i in range(30):
        add(
            "edited_campaign",
            attack + 4200 + i * 40,
            rng.choice(NEW_NORMAL),
            _edit(rng, PROMO[2]),
            (hop,),
        )

    # Look-alike letters to dodge text matching.
    hop = _hop(rng, taken)
    for i in range(24):
        add(
            "disguised_text",
            attack + 5000 + i * 30,
            _made_up(rng),
            rng.choice(HOMOGLYPH),
            _via(rng, hop),
        )

    # Real-looking first names with a random tag, short texts.
    for i in range(30):
        tag = "".join(rng.choice("abcdefghjkmnpqrstuvwxyz0123456789") for _ in range(5))
        tag = tag[:2] + str(rng.randrange(10)) + tag[3:]
        name = f"{rng.choice(TAG_FIRST)}-{tag}"
        add(
            "tagged_names",
            attack + 7000 + i * 20,
            name,
            " ".join(rng.choices(SALAD, k=rng.randrange(2, 5))),
            _via(rng, _hop(rng, taken)),
        )

    # Short unreadable text under made-up names.
    for i in range(30):
        add(
            "unreadable_short",
            attack + 7800 + i * 15,
            _made_up(rng),
            "".join(rng.sample(ODD_CHARS, rng.randrange(3, 6))),
            _via(rng, _hop(rng, taken)),
        )

    # Links from new names.
    hop = _hop(rng, taken)
    for i in range(20):
        add(
            "link_spam",
            attack + 8400 + i * 45,
            rng.choice(NEW_NORMAL) + str(rng.randrange(10, 99)),
            f"great deals at http://deals.example/{rng.randrange(10**6)}",
            _via(rng, hop),
        )

    # Slow drip through one repeater over the whole attack.
    hop = _hop(rng, taken)
    for i in range(30):
        add("slow_drip", attack + i * 360, _made_up(rng), f"{PROMO[0][:40]} {i}", _via(rng, hop))

    # Names made of emoji only.
    hop = _hop(rng, taken)
    for i in range(20):
        name = "".join(rng.sample(EMOJI, 3))
        add("emoji_names", attack + 9200 + i * 20, name, _edit(rng, PROMO[1]), _via(rng, hop))

    # A regular's name copied by a spammer elsewhere (not gated).
    hop = _hop(rng, taken)
    for i in range(10):
        add("copied_name", attack + 9600 + i * 60, "Daan", _edit(rng, PROMO[0]), _via(rng, hop))

    out.sort(key=lambda m: m.ts)
    return out


class _Clock:
    def __init__(self) -> None:
        self.now = START

    def __call__(self) -> float:
        return self.now


def _openhop(det: SpamDetector) -> NodePolicy:
    rules = render(det, "openhop")
    objects = {
        OPENHOP_OBJECT_GROUP: {
            OPENHOP_KNOWN_SENDERS: rules.known_senders,
            OPENHOP_BOT_SENDERS: rules.bot_senders,
        }
    }
    return NodePolicy({"enabled": True, "rules": rules.rules, "objects": objects})


def _host(det: SpamDetector) -> tuple[list[PolicyRule], list[PolicyRule]]:
    rules = render(det, "host")
    return (
        [PolicyRule.model_validate(r) for r in rules.before],
        [PolicyRule.model_validate(r) for r in rules.after],
    )


def stored_chat(seed: int) -> list[tuple[str, int, float, float]]:
    """What RTFM-EV stored of the day before: most regulars chatted, some did not."""
    rng = random.Random(seed + 1)
    rows = []
    for name in REGULARS:
        if rng.random() < 0.8:
            first = START - rng.uniform(3600, 86400)
            rows.append((name, rng.randrange(1, 30), first, rng.uniform(first, START)))
    return rows


def simulate(seed: int = 7, *, fresh_start: bool = True, **overrides) -> Result:
    """Run the scenario. ``fresh_start`` learns from a day of stored chat first,
    as Spam Guard does when it starts without saved state."""
    clock = _Clock()
    config = SpamConfig(
        mode="protect", channels=[{"key": PUBLIC, "name": "Public"}], overrides=overrides
    )
    det = SpamDetector(config, clock=clock)
    if fresh_start:
        det.seed_known(stored_chat(seed))
    scores = {"host": Score(), "openhop": Score()}
    node = _openhop(det)
    host = _host(det)
    for index, message in enumerate(generate(seed)):
        clock.now = message.ts
        packet = group_text(message.sender, message.text, key=PUBLIC.lower(), path=message.path)
        verdict = node.evaluate(packet, rssi=-90, snr=5.0)
        scores["openhop"].add(message.kind, bool(verdict and verdict["action"] == "drop"))

        event = det.ingest(
            ts=message.ts,
            path=message.path,
            sender=message.sender,
            text=message.text,
            channel=PUBLIC,
            length=60,
            message_id=index,
        )
        if det.decide(rematch=event).changed:
            node = _openhop(det)
            host = _host(det)
        decision = evaluate_layers(host[0], PolicyConfig(), host[1], fields(event))
        scores["host"].add(message.kind, decision.action == "drop")
    return Result(scores)
