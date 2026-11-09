"""Minimal KiCad s-expression reader: lists of str/float/list."""
import re

TOKEN = re.compile(r'\(|\)|"(?:[^"\\]|\\.)*"|[^\s()"]+')

def parse(text: str):
    stack = [[]]
    for m in TOKEN.finditer(text):
        t = m.group(0)
        if t == "(":
            stack.append([])
        elif t == ")":
            done = stack.pop()
            stack[-1].append(done)
        elif t[0] == '"':
            stack[-1].append(bytes(t[1:-1], "utf-8").decode("unicode_escape").encode("latin-1").decode("utf-8"))
        else:
            stack[-1].append(t)
    return stack[0][0]

def head(node):
    return node[0] if isinstance(node, list) and node else None

def kids(node, name):
    return [c for c in node[1:] if isinstance(c, list) and c and c[0] == name]

def kid(node, name):
    for c in node[1:]:
        if isinstance(c, list) and c and c[0] == name:
            return c
    return None

def num(x):
    return float(x)
