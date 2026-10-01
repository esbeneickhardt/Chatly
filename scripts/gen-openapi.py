#!/usr/bin/env python3
"""Regenerates docs/openapi.json from the route tables in docs/api.md.

docs/api.md is the source of truth (a Rust test checks it against the
router); this turns its tables into an OpenAPI 3 route inventory so tools
can consume the API. Run it after changing docs/api.md:

    python3 scripts/gen-openapi.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
METHODS = "GET|POST|PUT|PATCH|DELETE"
ROW = re.compile(rf"^\| ({METHODS})(?:/({METHODS}))? \| `([^`]+)` \| (.*?) \| (.*) \|$")


def build(doc: str) -> dict:
    tags: list[str] = []
    paths: dict = {}
    section = None
    for line in doc.split("\n"):
        heading = re.match(r"^##+ (.*)", line)
        if heading:
            section = heading.group(1).strip()
        row = ROW.match(line)
        if not row:
            continue
        methods = [m for m in (row.group(1), row.group(2)) if m]
        path, who, purpose = row.group(3), row.group(4), row.group(5)
        params = [
            {"name": p, "in": "path", "required": True, "schema": {"type": "string"}}
            for p in re.findall(r"\{(\w+)\}", path)
        ]
        for method in methods:
            op = {
                "summary": purpose,
                "description": f"Who can call it: {who}.",
                "tags": [section],
                "responses": {
                    "2XX": {"description": "Success"},
                    "default": {
                        "description": "An error",
                        "content": {
                            "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                        },
                    },
                },
            }
            if params:
                op["parameters"] = params
            if who.strip().lower().startswith(("anyone", "none")):
                op["security"] = []
            oapath = re.sub(r":(\w+)", r"{\1}", path)
            paths.setdefault(oapath, {})[method.lower()] = op
            if section not in tags:
                tags.append(section)
    return {
        "openapi": "3.0.3",
        "info": {
            "title": "Chatly HTTP API",
            "version": "0.1.0",
            "description": "A route inventory generated from docs/api.md (which is checked "
            "against the router). Request and response bodies are documented in prose in "
            "docs/api.md; every failure has the Error shape below. Mutating requests need "
            "an X-Requested-With header.",
        },
        "servers": [{"url": "/api"}],
        "security": [{"sessionCookie": []}, {"botToken": []}],
        "tags": [{"name": t} for t in tags],
        "paths": dict(sorted(paths.items())),
        "components": {
            "securitySchemes": {
                "sessionCookie": {"type": "apiKey", "in": "cookie", "name": "session"},
                "botToken": {
                    "type": "apiKey",
                    "in": "header",
                    "name": "Authorization",
                    "description": "`Bot <token>`",
                },
            },
            "schemas": {
                "Error": {
                    "type": "object",
                    "required": ["error"],
                    "properties": {
                        "error": {
                            "type": "object",
                            "required": ["code", "message"],
                            "properties": {
                                "code": {"type": "string", "description": "stable, machine-matchable"},
                                "message": {"type": "string", "description": "for humans; may change"},
                            },
                        }
                    },
                }
            },
        },
    }


if __name__ == "__main__":
    spec = build((ROOT / "docs/api.md").read_text())
    (ROOT / "docs/openapi.json").write_text(json.dumps(spec, indent=2) + "\n")
    ops = sum(len(v) for v in spec["paths"].values())
    print(f"docs/openapi.json: {len(spec['paths'])} paths, {ops} operations")
