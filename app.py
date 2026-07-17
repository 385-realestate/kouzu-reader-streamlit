import pathlib

import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(page_title="公図PDF変換ツール", layout="wide")

st.markdown(
    """
    <style>
    .block-container {
        padding-top: 0rem;
        padding-bottom: 0rem;
        padding-left: 0rem;
        padding-right: 0rem;
        max-width: 100%;
    }
    iframe {
        margin: 0;
        display: block;
    }
    header[data-testid="stHeader"] {
        height: 0;
        min-height: 0;
    }
    div[data-testid="stToolbar"] {
        display: none;
    }
    div[data-testid="stDecoration"] {
        display: none;
    }
    body, .stApp, [data-testid="stAppViewContainer"], [data-testid="stMain"] {
        background: #1a1a2e;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

html_path = pathlib.Path(__file__).parent / "kouzu_reader.html"
html_content = html_path.read_text(encoding="utf-8")

components.html(html_content, height=1400, scrolling=True)
