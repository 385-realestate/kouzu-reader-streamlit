import pathlib

import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(page_title="公図PDF変換ツール", layout="wide")

st.markdown(
    """
    <style>
    .block-container {
        padding-top: 0.5rem;
        padding-bottom: 0rem;
        padding-left: 1rem;
        padding-right: 1rem;
    }
    iframe {
        margin: 0;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

html_path = pathlib.Path(__file__).parent / "kouzu_reader.html"
html_content = html_path.read_text(encoding="utf-8")

components.html(html_content, height=1400, scrolling=True)
