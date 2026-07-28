# -*- coding: utf-8 -*-
"""Helpers to build an RTL Persian Word document with real footnotes,
using python-docx plus direct OOXML manipulation (python-docx has no
native footnote support)."""

from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml.ns import qn
from docx.oxml import OxmlElement, parse_xml
from docx.opc.part import XmlPart
from docx.opc.packuri import PackURI
from docx.opc.constants import CONTENT_TYPE as CT

FONT_NAME = "B Nazanin"
BODY_SIZE = 13
FOOTNOTE_SIZE = 11

FOOTNOTES_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"
)
FOOTNOTES_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes"
)

FOOTNOTES_XML_HEADER = (
    '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
    '<w:r><w:separator/></w:r></w:p></w:footnote>'
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
    '<w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
    '</w:footnotes>'
)


def set_rtl_bidi(paragraph):
    pPr = paragraph._p.get_or_add_pPr()
    bidi = OxmlElement('w:bidi')
    pPr.append(bidi)


def set_run_rtl_font(run, size=BODY_SIZE, bold=False, name=FONT_NAME):
    run.font.name = name
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.rtl = True
    rPr = run._r.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts')
        rPr.append(rFonts)
    rFonts.set(qn('w:ascii'), name)
    rFonts.set(qn('w:hAnsi'), name)
    rFonts.set(qn('w:cs'), name)
    rFonts.set(qn('w:eastAsia'), name)
    sz_cs = rPr.find(qn('w:szCs'))
    if sz_cs is None:
        sz_cs = OxmlElement('w:szCs')
        rPr.append(sz_cs)
    sz_cs.set(qn('w:val'), str(int(size * 2)))
    lang = rPr.find(qn('w:lang'))
    if lang is None:
        lang = OxmlElement('w:lang')
        rPr.append(lang)
    lang.set(qn('w:bidi'), 'fa-IR')


class FootnoteManager:
    """Adds a footnotes.xml part to the document package and lets you
    insert real Word footnote references + footnote body text."""

    def __init__(self, document):
        self.document = document
        self._next_id = 1
        self._element = parse_xml(FOOTNOTES_XML_HEADER)
        package = document.part.package
        partname = PackURI('/word/footnotes.xml')
        self.part = XmlPart(partname, FOOTNOTES_CONTENT_TYPE, self._element, package)
        document.part.relate_to(self.part, FOOTNOTES_REL_TYPE)
        self._ensure_settings_footnote_pr()
        self._ensure_styles()

    def _ensure_settings_footnote_pr(self):
        settings_part = self.document.settings.element
        if settings_part.find(qn('w:footnotePr')) is None:
            pass  # optional; Word will use defaults fine without it

    def _ensure_styles(self):
        styles = self.document.styles
        style_names = {s.name for s in styles}
        if 'Footnote Text' not in style_names:
            fn_text = styles.add_style('Footnote Text', WD_STYLE_TYPE.PARAGRAPH)
            fn_text.base_style = styles['Normal']
            fn_text.font.size = Pt(FOOTNOTE_SIZE)
            fn_text.font.name = FONT_NAME
        if 'Footnote Reference' not in style_names:
            fn_ref = styles.add_style('Footnote Reference', WD_STYLE_TYPE.CHARACTER)
            fn_ref.font.superscript = True

    def add_footnote(self, paragraph, number, persian_text):
        """Append a footnote reference at the current end of `paragraph`
        and register footnote body text (a single-paragraph note) with
        explicit footnote `number` (must be inserted in increasing order,
        matching self._next_id)."""
        assert number == self._next_id, "Footnotes must be added in order"

        run = paragraph.add_run()
        rPr = OxmlElement('w:rPr')
        rStyle = OxmlElement('w:rStyle')
        rStyle.set(qn('w:val'), 'FootnoteReference')
        rPr.append(rStyle)
        rFonts = OxmlElement('w:rFonts')
        rFonts.set(qn('w:ascii'), FONT_NAME)
        rFonts.set(qn('w:hAnsi'), FONT_NAME)
        rFonts.set(qn('w:cs'), FONT_NAME)
        rFonts.set(qn('w:eastAsia'), FONT_NAME)
        rPr.append(rFonts)
        rtl = OxmlElement('w:rtl')
        rPr.append(rtl)
        run._r.append(rPr)
        fn_ref = OxmlElement('w:footnoteReference')
        fn_ref.set(qn('w:id'), str(number))
        run._r.append(fn_ref)

        footnote_el = OxmlElement('w:footnote')
        footnote_el.set(qn('w:id'), str(number))

        p_el = OxmlElement('w:p')
        pPr = OxmlElement('w:pPr')
        pStyle = OxmlElement('w:pStyle')
        pStyle.set(qn('w:val'), 'FootnoteText')
        pPr.append(pStyle)
        bidi = OxmlElement('w:bidi')
        pPr.append(bidi)
        jc = OxmlElement('w:jc')
        jc.set(qn('w:val'), 'both')
        pPr.append(jc)
        p_el.append(pPr)

        ref_run = OxmlElement('w:r')
        ref_rPr = OxmlElement('w:rPr')
        ref_rStyle = OxmlElement('w:rStyle')
        ref_rStyle.set(qn('w:val'), 'FootnoteReference')
        ref_rPr.append(ref_rStyle)
        ref_run.append(ref_rPr)
        ref_mark = OxmlElement('w:footnoteRef')
        ref_run.append(ref_mark)
        p_el.append(ref_run)

        text_run = OxmlElement('w:r')
        text_rPr = OxmlElement('w:rPr')
        t_rFonts = OxmlElement('w:rFonts')
        t_rFonts.set(qn('w:ascii'), FONT_NAME)
        t_rFonts.set(qn('w:hAnsi'), FONT_NAME)
        t_rFonts.set(qn('w:cs'), FONT_NAME)
        t_rFonts.set(qn('w:eastAsia'), FONT_NAME)
        text_rPr.append(t_rFonts)
        sz = OxmlElement('w:sz')
        sz.set(qn('w:val'), str(int(FOOTNOTE_SIZE * 2)))
        text_rPr.append(sz)
        szCs = OxmlElement('w:szCs')
        szCs.set(qn('w:val'), str(int(FOOTNOTE_SIZE * 2)))
        text_rPr.append(szCs)
        t_rtl = OxmlElement('w:rtl')
        text_rPr.append(t_rtl)
        text_run.append(text_rPr)
        space_run = OxmlElement('w:t')
        space_run.set(qn('xml:space'), 'preserve')
        space_run.text = ' ' + persian_text
        text_run.append(space_run)
        p_el.append(text_run)

        footnote_el.append(p_el)
        self._element.append(footnote_el)
        self._next_id += 1
        return run
