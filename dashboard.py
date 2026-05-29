"""
Panel Financiero Argentina — Streamlit Dashboard
Auto-refresh cada 60 segundos. Fuentes: dolarapi.com, argentinadatos.com, bcra.gob.ar
"""

import streamlit as st
import requests
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from datetime import datetime, timedelta, date
from streamlit_autorefresh import st_autorefresh

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
st.set_page_config(
    page_title="Panel Financiero Argentina",
    page_icon="🇦🇷",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# Auto-refresh cada 60 segundos
st_autorefresh(interval=60_000, key="autorefresh")

DARK = "plotly_dark"
TODAY = date.today().isoformat()

# ─────────────────────────────────────────────
# CSS
# ─────────────────────────────────────────────
st.markdown("""
<style>
    .main { background-color: #0e1117; }
    .kpi-card {
        background: #1c2333;
        border-radius: 10px;
        padding: 16px 20px;
        border-left: 4px solid #4a9eff;
        margin-bottom: 6px;
    }
    .kpi-label { font-size: 12px; color: #8892a4; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; }
    .kpi-value { font-size: 28px; font-weight: 700; color: #f0f2f6; margin: 4px 0; }
    .kpi-delta-pos { font-size: 13px; color: #00c853; }
    .kpi-delta-neg { font-size: 13px; color: #ff5252; }
    .kpi-delta-neu { font-size: 13px; color: #8892a4; }
    .offline-badge { background: #3a2000; color: #ffa726; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
    .section-title { font-size: 16px; font-weight: 600; color: #c9d1d9; margin: 16px 0 6px 0; border-bottom: 1px solid #2d3748; padding-bottom: 4px; }
    footer-note { font-size: 11px; color: #6b7280; }
</style>
""", unsafe_allow_html=True)

# ─────────────────────────────────────────────
# DATA FETCHERS  (todas con caché TTL=60s)
# ─────────────────────────────────────────────

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def safe_get(url, timeout=8):
    try:
        r = requests.get(url, timeout=timeout, verify=False,
                         headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        return r.json(), None
    except Exception as e:
        return None, str(e)


MARKET_OPEN = 10 * 60 + 30  # 10:30 en minutos desde medianoche

def is_pre_market():
    """True si el mercado aún no abrió hoy (antes de las 10:30 hora local)."""
    now = datetime.now()
    return (now.hour * 60 + now.minute) < MARKET_OPEN


@st.cache_data(ttl=60)
def fetch_dolares():
    data, err = safe_get("https://dolarapi.com/v1/dolares")
    if data:
        return {d["casa"]: d for d in data}, None
    return {}, err


@st.cache_data(ttl=300)
def fetch_cierre_ayer():
    """
    Obtiene el último dato disponible de cada tipo de cambio desde el histórico.
    Usado antes de las 10:30 para mostrar el cierre del día anterior.
    Devuelve dict con keys: mayorista, blue, mep, ccl  →  {venta, compra, fecha}
    """
    result = {}

    endpoints = {
        "mayorista": "https://api.argentinadatos.com/v1/cotizaciones/dolares/mayorista",
        "blue":      "https://api.argentinadatos.com/v1/cotizaciones/dolares/blue",
        "mep":       "https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa",
        "ccl":       "https://api.argentinadatos.com/v1/cotizaciones/dolares/contadoconliqui",
    }

    for key, url in endpoints.items():
        data, _ = safe_get(url)
        if data and isinstance(data, list) and len(data) >= 2:
            # Último registro = cierre más reciente, penúltimo = anterior (para delta)
            last  = data[-1]
            prev  = data[-2]
            result[key] = {
                "venta":       last.get("venta") or last.get("valor"),
                "compra":      last.get("compra"),
                "fecha":       last.get("fecha", ""),
                "venta_prev":  prev.get("venta") or prev.get("valor"),
            }

    return result


@st.cache_data(ttl=60)
def fetch_historico_oficial():
    data, err = safe_get("https://api.argentinadatos.com/v1/cotizaciones/dolares/mayorista")
    if data:
        df = pd.DataFrame(data)
        df["fecha"] = pd.to_datetime(df["fecha"])
        df = df.sort_values("fecha").tail(90)
        return df, None
    return pd.DataFrame(), err


@st.cache_data(ttl=60)
def fetch_historico_blue():
    data, err = safe_get("https://api.argentinadatos.com/v1/cotizaciones/dolares/blue")
    if data:
        df = pd.DataFrame(data)
        df["fecha"] = pd.to_datetime(df["fecha"])
        df = df.sort_values("fecha").tail(90)
        return df, None
    return pd.DataFrame(), err




@st.cache_data(ttl=300)
def fetch_plazo_fijo():
    """Tasas de plazo fijo por entidad (argentinadatos.com)."""
    data, err = safe_get("https://api.argentinadatos.com/v1/finanzas/tasas/plazoFijo")
    if data and isinstance(data, list):
        rows = []
        for d in data:
            tna = d.get("tnaClientes")
            entidad = d.get("entidad", "")
            if tna is not None and entidad:
                # nombre corto: quitar "S.A.", "S.A.U.", etc.
                nombre = (entidad.replace(" S.A.U.", "").replace(" S.A.", "")
                                 .replace(" S.A.U", "").replace("Banco ", "")
                                 .strip())
                rows.append({"entidad": nombre, "tna": round(float(tna) * 100, 2)})
        rows.sort(key=lambda x: x["tna"], reverse=True)
        return rows, None
    return [], err


@st.cache_data(ttl=60)
def fetch_futuros_rofex():
    """Precios de cierre de futuros DLR desde Matba-Rofex (visor de precios público)."""
    import calendar as _cal
    MESES = {"01":"ENE","02":"FEB","03":"MAR","04":"ABR","05":"MAY","06":"JUN",
              "07":"JUL","08":"AGO","09":"SEP","10":"OCT","11":"NOV","12":"DIC"}
    try:
        r = requests.get(
            "https://ws.matbarofex.com.ar:8999/api/cierres",
            timeout=8, verify=False,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Origin":     "https://www.matbarofex.com.ar",
                "Referer":    "https://www.matbarofex.com.ar/",
            }
        )
        r.raise_for_status()
        monedas = r.json().get("monedas", [])
        rows = []
        for m in monedas:
            sym = m.get("Symbol", "")
            if not (sym.startswith("DLR") and len(sym) == 9 and m.get("CFICode") == "FXXXSX"):
                continue
            mm, yy = sym[3:5], sym[5:9]
            label = f"{MESES.get(mm, mm)}{yy[2:]}"
            last_day = _cal.monthrange(int(yy), int(mm))[1]
            maturity = date(int(yy), int(mm), last_day)
            grp = m.get("MDFullGrp", [{}])
            price = grp[0].get("MDEntryPx") if grp else None
            fecha_dato = grp[0].get("MDEntryDate", "") if grp else ""
            if price:
                rows.append({
                    "vencimiento": label,
                    "mes": f"{yy}-{mm}",
                    "precio": price,
                    "maturity": maturity,
                    "fecha_dato": fecha_dato,
                })
        rows.sort(key=lambda x: x["mes"])
        return rows, None
    except Exception as e:
        return [], str(e)


_ROFEX_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Origin":     "https://www.matbarofex.com.ar",
    "Referer":    "https://www.matbarofex.com.ar/",
}


@st.cache_data(ttl=3600)
def fetch_ipc():
    """IPC variación mensual — últimos 13 meses (INDEC vía datos.gob.ar)."""
    url = ("https://apis.datos.gob.ar/series/api/series"
           "?ids=148.3_INIVELNAL_DICI_M_26:percent_change&limit=13&sort=desc")
    data, err = safe_get(url)
    if data and "data" in data:
        rows = [{"fecha": d[0][:7], "ipc_pct": round(d[1] * 100, 2)}
                for d in data["data"] if d[1] is not None]
        return list(reversed(rows)), None
    return [], err


@st.cache_data(ttl=3600)
def fetch_uva():
    """UVA diario — último valor disponible (datos.gob.ar)."""
    url = "https://apis.datos.gob.ar/series/api/series?ids=94.2_UVAD_D_0_0_10&limit=5&sort=desc"
    data, err = safe_get(url)
    if data and "data" in data and data["data"]:
        last = data["data"][0]
        return {"fecha": last[0], "valor": last[1]}, None
    return {}, err




@st.cache_data(ttl=3600)
def fetch_badlar():
    """
    BADLAR TNA% — histórico desde datos.gob.ar + valor actual scrapeado del BCRA.
    Retorna: (hist_rows, current_val, current_fecha)
    """
    import re as _re

    # ── Histórico (datos.gob.ar, puede estar desactualizado) ──
    hist_rows = []
    url = ("https://apis.datos.gob.ar/series/api/series"
           "?ids=89.2_TS_INTELAR_0_D_20&limit=180&sort=desc")
    data, _ = safe_get(url)
    if data and "data" in data:
        rows = [{"fecha": d[0], "tna": d[1]} for d in data["data"] if d[1] is not None]
        hist_rows = list(reversed(rows))

    # ── Valor actual (BCRA HTML — actualiza diario) ──
    bcra_val, bcra_fecha = None, None
    try:
        r = requests.get(
            "https://www.bcra.gob.ar/PublicacionesEstadisticas/principales_variables.asp",
            timeout=10, verify=False,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
        )
        if r.status_code == 200:
            m = _re.search(
                r"BADLAR en pesos de bancos privados \(en % n\.a\.\)"
                r"[^<]*</a>\s*</td>\s*<td>(\d{2}/\d{2}/\d{4})</td>\s*<td>([\d,]+)</td>",
                r.text,
            )
            if m:
                bcra_fecha = m.group(1)          # "23/04/2026"
                bcra_val   = float(m.group(2).replace(",", "."))  # 22.0000
    except Exception:
        pass

    return hist_rows, bcra_val, bcra_fecha


@st.cache_data(ttl=300)
def fetch_caucion_hist():
    """Tasa de caución overnight ROFEX — últimos 6 meses."""
    from_d = (date.today() - timedelta(days=180)).isoformat()
    to_d   = date.today().isoformat()
    try:
        r = requests.get(
            f"https://ws.matbarofex.com.ar:8999/api/caucion?from={from_d}&to={to_d}",
            timeout=8, verify=False, headers=_ROFEX_HEADERS,
        )
        r.raise_for_status()
        rows = [{"fecha": d["date"][:10], "tna": d["value"]} for d in r.json() if d.get("value")]
        return rows, None
    except Exception as e:
        return [], str(e)


@st.cache_data(ttl=300)
def fetch_rfx20_hist():
    """Índice RFX20 — últimos 6 meses (Matba-Rofex)."""
    from_d = (date.today() - timedelta(days=180)).isoformat()
    to_d   = date.today().isoformat()
    try:
        r = requests.get(
            f"https://ws.matbarofex.com.ar:8999/api/rfx20/index?from={from_d}&to={to_d}",
            timeout=8, verify=False, headers=_ROFEX_HEADERS,
        )
        r.raise_for_status()
        rows = [{"fecha": d["date"], "valor": d["value"]} for d in r.json() if d.get("value")]
        return rows, None
    except Exception as e:
        return [], str(e)




# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────

def fmt_pesos(v):
    return f"${v:,.2f}" if v else "—"

def fmt_delta(val, prev, fmt="$.2f", invert=False):
    if val is None or prev is None:
        return '<span class="kpi-delta-neu">—</span>'
    diff = val - prev
    pct = (diff / prev * 100) if prev else 0
    sign = "+" if diff >= 0 else ""
    color_class = "kpi-delta-neg" if diff > 0 else "kpi-delta-pos"
    if invert:
        color_class = "kpi-delta-pos" if diff > 0 else "kpi-delta-neg"
    # Risk country: up is bad
    arrow = "▲" if diff > 0 else "▼"
    return f'<span class="{color_class}">{arrow} {sign}{diff:,.1f} ({sign}{pct:.1f}%)</span>'

def kpi_card(label, value, delta_html, offline=False, accent="#4a9eff"):
    badge = ' <span class="offline-badge">OFFLINE</span>' if offline else ""
    return f"""
<div class="kpi-card" style="border-left-color:{accent}">
  <div class="kpi-label">{label}{badge}</div>
  <div class="kpi-value">{value}</div>
  <div>{delta_html}</div>
</div>"""


def get_val(dct, key, subkey="venta"):
    item = dct.get(key, {})
    return item.get(subkey)


def interp(texto):
    st.markdown(
        f'<div style="background:#151e2e;border-left:3px solid #4a9eff;padding:8px 14px;'
        f'border-radius:0 4px 4px 0;font-size:12px;color:#b0bec5;margin-top:4px;line-height:1.5">'
        f'💡 {texto}</div>',
        unsafe_allow_html=True,
    )


# ─────────────────────────────────────────────
# BANDA CAMBIARIA BCRA
# Arranque: $1.000 el 13/4/2025, +1% mensual hasta dic 2025, +2.9% mensual desde ene 2026
# ─────────────────────────────────────────────

def calcular_banda(fecha_inicio=date(2025, 4, 13), base_sup=1400.0, base_inf=1000.0):
    """
    Banda cambiaria BCRA. Techo: $1.400 el 13/4/2025. Piso: $1.000.
    Ambas crecen +1%/mes hasta dic 2025, luego +2.9%/mes desde ene 2026.
    """
    hoy = date.today()
    dates = []
    sups = []
    infs = []
    val_sup = base_sup
    val_inf = base_inf
    current = fecha_inicio

    while current <= hoy + timedelta(days=60):  # proyectar 60 días adelante
        dates.append(current)
        sups.append(round(val_sup, 2))
        infs.append(round(val_inf, 2))
        # Avanzar al siguiente día
        next_d = current + timedelta(days=1)
        # Si es primero de mes (o cruzamos el mes), aplicar tasa mensual
        if next_d.month != current.month:
            if next_d >= date(2026, 1, 1):
                tasa = 0.029  # 2.9% mensual desde ene 2026
            else:
                tasa = 0.01   # 1% mensual hasta dic 2025
            val_sup = val_sup * (1 + tasa)
            val_inf = val_inf * (1 + tasa)
        current = next_d

    return pd.DataFrame({"fecha": dates, "banda_sup": sups, "banda_inf": infs})




# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

def main():
    now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

    # ── HEADER ──
    col_h1, col_h2 = st.columns([3, 1])
    with col_h1:
        st.markdown("# 🇦🇷 Panel Financiero Argentina")
    with col_h2:
        st.markdown(f"<div style='text-align:right; color:#8892a4; padding-top:16px'>🕐 {now_str}</div>",
                    unsafe_allow_html=True)

    # ── FETCH DATA ──
    dolares, err_dol = fetch_dolares()
    hist_of, err_hof = fetch_historico_oficial()
    hist_blue, err_hbl = fetch_historico_blue()
    pf_rows, err_pf              = fetch_plazo_fijo()
    ipc_rows, _                  = fetch_ipc()
    uva_data, _                  = fetch_uva()
    badlar_rows, badlar_val, badlar_fecha = fetch_badlar()
    caucion_rows, _              = fetch_caucion_hist()
    rfx20_rows, _    = fetch_rfx20_hist()
    offline_dol = bool(err_dol)

    # ── Siempre cargar cierre ayer como fallback ──
    pre_market = is_pre_market()
    cierre_ayer = fetch_cierre_ayer()  # siempre disponible, TTL=300s, bajo costo

    def resolve_dolar(live_dct, ayer_dct, live_key, ayer_key):
        """
        Prioridad:
          1. Pre-mercado → argentinadatos histórico (cierre ayer)
          2. Horario mercado → dolarapi live
          3. Fallback si dolarapi falla → argentinadatos histórico
          4. Si todo falla → None
        Devuelve (venta, prev_venta, es_cierre_ayer, offline_total)
        """
        # Pre-mercado: usar histórico directamente
        if pre_market:
            if ayer_key in ayer_dct:
                d = ayer_dct[ayer_key]
                return d.get("venta"), d.get("venta_prev"), True, False
            return None, None, False, True

        # Horario de mercado: preferir live
        v = get_val(live_dct, live_key)
        if v is not None:
            return v, None, False, False

        # Fallback a histórico si dolarapi falló
        if ayer_key in ayer_dct:
            d = ayer_dct[ayer_key]
            return d.get("venta"), d.get("venta_prev"), True, False

        return None, None, False, True  # ambas fuentes fallaron

    maj_v,  maj_prev,  maj_cierre, maj_off  = resolve_dolar(dolares, cierre_ayer, "mayorista",       "mayorista")
    blue_v, blue_prev, blue_cierre,blue_off = resolve_dolar(dolares, cierre_ayer, "blue",             "blue")
    mep_v,  mep_prev,  mep_cierre, mep_off  = resolve_dolar(dolares, cierre_ayer, "bolsa",            "mep")
    ccl_v,  ccl_prev,  ccl_cierre, ccl_off  = resolve_dolar(dolares, cierre_ayer, "contadoconliqui",  "ccl")

    # Fecha del cierre para mostrar en el label
    fecha_cierre_str = ""
    if cierre_ayer:
        primer_key = next(iter(cierre_ayer))
        raw_fecha = cierre_ayer[primer_key].get("fecha", "")
        if raw_fecha:
            try:
                fecha_cierre_str = datetime.strptime(raw_fecha[:10], "%Y-%m-%d").strftime("%d/%m")
            except Exception:
                fecha_cierre_str = raw_fecha[:10]

    # ─────────────────────────────────────────
    # FILA 1 — KPIs
    # ─────────────────────────────────────────
    cierre_badge = f" · cierre {fecha_cierre_str}" if pre_market and fecha_cierre_str else ""
    seccion_label = f"Tipo de Cambio · Referencia{cierre_badge}"
    st.markdown(f'<div class="section-title">{seccion_label}</div>', unsafe_allow_html=True)

    if pre_market:
        st.info(f"🕙 Mercado cerrado — mostrando cierre del {fecha_cierre_str or 'día anterior'}. Datos live a partir de las 10:30 hs.")

    k1, k2, k3, k4 = st.columns(4)
    cols_kpi = [k1, k2, k3, k4]

    def make_kpi_label(base, is_cierre):
        return base + (" · cierre" if is_cierre else "")

    kpis = [
        (make_kpi_label("Dólar Mayorista", maj_cierre),  maj_v,  maj_prev,  "#4a9eff", False, maj_off),
        (make_kpi_label("Dólar Blue",      blue_cierre), blue_v, blue_prev, "#7c3aed", False, blue_off),
        (make_kpi_label("Dólar MEP",       mep_cierre),  mep_v,  mep_prev,  "#00bcd4", False, mep_off),
        (make_kpi_label("Dólar CCL",       ccl_cierre),  ccl_v,  ccl_prev,  "#ff7043", False, ccl_off),
    ]

    for col, (label, val, prev_val, accent, invert, off) in zip(cols_kpi, kpis):
        with col:
            v_str = fmt_pesos(val)
            delta = fmt_delta(val, prev_val)
            st.markdown(kpi_card(label, v_str, delta, offline=off, accent=accent),
                        unsafe_allow_html=True)

    # ─────────────────────────────────────────
    # FILA 1b — Otras divisas + RFX20 + Caución + UVA
    # ─────────────────────────────────────────
    def _div(d_list, moneda):
        for d in d_list:
            if d.get("moneda") == moneda:
                return d.get("venta"), d.get("compra")
        return None, None

    # fetch_dolares devuelve {casa: {...}} pero las divisas vienen de /v1/cotizaciones
    # que tiene todas con casa="oficial" diferenciadas por moneda → usar raw
    cotiz_raw, _ = safe_get("https://dolarapi.com/v1/cotizaciones")
    cotiz_list = cotiz_raw if isinstance(cotiz_raw, list) else []
    eur_v, _  = _div(cotiz_list, "EUR")
    brl_v, _  = _div(cotiz_list, "BRL")
    uyu_v, _  = _div(cotiz_list, "UYU")

    rfx_val  = rfx20_rows[-1]["valor"]  if rfx20_rows else None
    rfx_prev = rfx20_rows[-2]["valor"]  if len(rfx20_rows) > 1 else None

    cau_val  = caucion_rows[-1]["tna"]  if caucion_rows else None
    cau_prev = caucion_rows[-2]["tna"]  if len(caucion_rows) > 1 else None

    uva_val = uva_data.get("valor")
    uva_fecha = uva_data.get("fecha", "")

    d1, d2, d3, d4, d5, d6, d7 = st.columns(7)
    _badlar_label = f"BADLAR TNA% ({badlar_fecha})" if badlar_fecha else "BADLAR TNA%"
    extras = [
        ("Euro (BNA venta)",   eur_v,      None,       "#43a047", False, not bool(eur_v)),
        ("Real BRL (BNA)",     brl_v,      None,       "#00897b", False, not bool(brl_v)),
        ("Peso Uruguayo",      uyu_v,      None,       "#5e35b1", False, not bool(uyu_v)),
        ("RFX20",              rfx_val,    rfx_prev,   "#ef6c00", False, not bool(rfx_val)),
        ("Caución 1d TNA%",    cau_val,    cau_prev,   "#0097a7", False, not bool(cau_val)),
        (_badlar_label,        badlar_val, None,       "#ffa726", False, not bool(badlar_val)),
        (f"UVA ({uva_fecha})", uva_val,    None,       "#8d6e63", False, not bool(uva_val)),
    ]
    for col, (label, val, prev_val, accent, invert, off) in zip([d1,d2,d3,d4,d5,d6,d7], extras):
        with col:
            if label.startswith("Caución") or label.startswith("BADLAR"):
                v_str = f"{val:.2f}%" if val else "—"
                delta = fmt_delta(val, prev_val, invert=False)
            elif label.startswith("RFX20"):
                v_str = f"{val:,.0f}" if val else "—"
                delta = fmt_delta(val, prev_val, invert=False)
            elif label.startswith("UVA"):
                v_str = f"${val:,.2f}" if val else "—"
                delta = '<span class="kpi-delta-neu">índice 31-mar-2016=14,05</span>'
            else:
                v_str = fmt_pesos(val)
                delta = '<span class="kpi-delta-neu">—</span>'
            st.markdown(kpi_card(label, v_str, delta, offline=off, accent=accent),
                        unsafe_allow_html=True)

    # ─────────────────────────────────────────
    # FILA 2 — Banda cambiaria BCRA
    # ─────────────────────────────────────────
    st.markdown('<div class="section-title">Banda Cambiaria BCRA</div>', unsafe_allow_html=True)

    banda_df = calcular_banda()

    fig_banda = go.Figure()

    # Zona sombreada entre bandas
    fig_banda.add_trace(go.Scatter(
        x=list(banda_df["fecha"]) + list(banda_df["fecha"])[::-1],
        y=list(banda_df["banda_sup"]) + list(banda_df["banda_inf"])[::-1],
        fill="toself",
        fillcolor="rgba(74, 158, 255, 0.08)",
        line=dict(color="rgba(255,255,255,0)"),
        name="Zona de intervención",
        showlegend=True,
        hoverinfo="skip",
    ))

    # Banda superior
    fig_banda.add_trace(go.Scatter(
        x=banda_df["fecha"], y=banda_df["banda_sup"],
        line=dict(color="#4a9eff", width=2, dash="dot"),
        name="Techo BCRA (+2.9%/mes)",
    ))

    # Banda inferior
    fig_banda.add_trace(go.Scatter(
        x=banda_df["fecha"], y=banda_df["banda_inf"],
        line=dict(color="#4a9eff", width=2, dash="dot"),
        name="Piso BCRA",
    ))

    # Blue
    if not hist_blue.empty and "venta" in hist_blue.columns:
        fig_banda.add_trace(go.Scatter(
            x=hist_blue["fecha"], y=hist_blue["venta"],
            line=dict(color="#7c3aed", width=1.5, dash="dash"),
            name="Dólar Blue",
            hovertemplate="Blue: $%{y:,.1f}<extra></extra>",
        ))

    # CCL actual como línea horizontal
    if ccl_v:
        fig_banda.add_hline(y=ccl_v, line_dash="longdash", line_color="#ff7043",
                             annotation_text=f"CCL ${ccl_v:,.1f}", annotation_position="top left")

    # Dólar Mayorista — línea principal con marcador en el último valor
    if not hist_of.empty and "venta" in hist_of.columns:
        # Línea principal
        fig_banda.add_trace(go.Scatter(
            x=hist_of["fecha"], y=hist_of["venta"],
            line=dict(color="#00e676", width=3),
            name="Dólar Mayorista",
            hovertemplate="Mayorista: $%{y:,.1f}<extra></extra>",
        ))
        # Punto destacado en el último cierre
        ultimo_fecha = hist_of["fecha"].iloc[-1]
        ultimo_val   = hist_of["venta"].iloc[-1]
        fig_banda.add_trace(go.Scatter(
            x=[ultimo_fecha], y=[ultimo_val],
            mode="markers+text",
            marker=dict(color="#00e676", size=10, symbol="circle",
                        line=dict(color="white", width=2)),
            text=[f"  Mayorista ${ultimo_val:,.1f}"],
            textposition="middle right",
            textfont=dict(color="#00e676", size=13, family="monospace"),
            showlegend=False,
            hoverinfo="skip",
        ))

    fig_banda.update_layout(
        template=DARK, height=400,
        margin=dict(l=40, r=40, t=20, b=40),
        legend=dict(orientation="h", yanchor="bottom", y=1.01, xanchor="right", x=1),
        xaxis_title="", yaxis_title="ARS / USD",
        hovermode="x unified",
    )
    st.plotly_chart(fig_banda, width="stretch")

    # Interpretación: Banda Cambiaria
    if maj_v and not banda_df.empty:
        _today = date.today()
        _techo_hoy = banda_df[banda_df["fecha"] <= _today]["banda_sup"].iloc[-1]
        _piso_hoy  = banda_df[banda_df["fecha"] <= _today]["banda_inf"].iloc[-1]
        _margen_t  = (_techo_hoy - maj_v) / _techo_hoy * 100
        _margen_p  = (maj_v - _piso_hoy) / _piso_hoy * 100
        if maj_v < _piso_hoy:
            _pos = f"por debajo del piso (${_piso_hoy:,.0f}) — el BCRA debe comprar USD para defender la banda"
        elif maj_v > _techo_hoy:
            _pos = f"por encima del techo (${_techo_hoy:,.0f}) — el BCRA debe vender USD"
        else:
            _pos = f"dentro de la banda, a {_margen_t:.1f}% del techo (${_techo_hoy:,.0f}) y {_margen_p:.1f}% del piso"
        _ccl_txt = (f" El CCL (${ccl_v:,.1f}) cotiza {'dentro' if ccl_v <= _techo_hoy else 'fuera'} de la banda superior."
                    if ccl_v else "")
        interp(f"El mayorista (${maj_v:,.1f}) opera {_pos}. La banda se amplía +2.9%/mes.{_ccl_txt}")

    # ─────────────────────────────────────────
    # FILA 3 — ROFEX + Tasas
    # ─────────────────────────────────────────
    st.markdown('<div class="section-title">Futuros ROFEX · Tasas en Pesos</div>', unsafe_allow_html=True)
    col_rof, col_tasas = st.columns(2)

    # ── ROFEX ──
    with col_rof:
        st.markdown("**Curva ROFEX — Futuros Dólar**")

        futuros_rows, err_fut = fetch_futuros_rofex()

        spot = maj_v or 1280
        techo_actual = banda_df[banda_df["fecha"] <= date.today()]["banda_sup"].iloc[-1] if not banda_df.empty else 1688
        hoy_dt = datetime.today()

        def tna_implicita(precio, mat_date):
            try:
                venc = datetime(mat_date.year, mat_date.month, mat_date.day)
                dias = (venc - hoy_dt).days
                if dias <= 0:
                    dias = 1
                return round((precio / spot - 1) * (360 / dias) * 100, 1)
            except Exception:
                return None

        if futuros_rows:
            fut_df = pd.DataFrame(futuros_rows)
            fut_df["tna"] = fut_df.apply(
                lambda r: tna_implicita(r["precio"], r["maturity"]), axis=1
            )
            fecha_dato = futuros_rows[0].get("fecha_dato", "")

            fig_rof = go.Figure()
            fig_rof.add_trace(go.Scatter(
                x=fut_df["vencimiento"], y=fut_df["precio"],
                mode="lines+markers+text",
                line=dict(color="#ffa726", width=2),
                marker=dict(size=8, color="#ffa726"),
                text=[f"TNA {r:.1f}%" if r is not None else "" for r in fut_df["tna"]],
                textposition="top center",
                textfont=dict(size=10, color="#ffa726"),
                name="Futuro ROFEX",
            ))
            fig_rof.add_hline(y=spot, line_dash="solid", line_color="#00e676",
                               annotation_text=f"Spot ${spot:,.0f}", annotation_position="bottom right")
            fig_rof.update_layout(
                template=DARK, height=340,
                margin=dict(l=40, r=40, t=20, b=40),
                yaxis_title="ARS / USD",
                xaxis_title="Vencimiento",
                showlegend=False,
            )
            st.plotly_chart(fig_rof, width="stretch")
            # Interpretación: ROFEX
            if not fut_df.empty:
                _primer = fut_df.iloc[0]
                _ultim  = fut_df.iloc[-1]
                _dep_p  = (_primer["precio"] / spot - 1) * 100
                _dep_u  = (_ultim["precio"]  / spot - 1) * 100
                _tnas   = fut_df["tna"].dropna()
                _shape  = ("creciente (contango)" if len(_tnas) >= 2 and _tnas.iloc[-1] > _tnas.iloc[0]
                           else "plana o invertida" if len(_tnas) >= 2 else "")
                interp(
                    f"El contrato más próximo ({_primer['vencimiento']}) implica "
                    f"{_dep_p:.1f}% de devaluación desde el spot con TNA implícita de "
                    f"{_primer['tna']:.1f}%. El más largo ({_ultim['vencimiento']}) precia "
                    f"{_dep_u:.1f}% total. Curva {_shape}."
                )
            if fecha_dato:
                st.caption(f"Fuente: Matba-Rofex · Precios de cierre {fecha_dato}")
        else:
            st.warning(f"⚠️ No se pudieron obtener futuros ROFEX. {err_fut or ''}")

    # ── Plazo Fijo live ──
    with col_tasas:
        st.markdown("**Tasas Plazo Fijo por Entidad (TNA %)**")
        if pf_rows:
            pf_df = pd.DataFrame(pf_rows).sort_values("tna", ascending=True)
            _ipc_ref = ipc_rows[-1]["ipc_pct"] * 12 if ipc_rows else 24
            pf_colors = ["#00c853" if v >= _ipc_ref else "#ffa726" if v >= _ipc_ref * 0.85 else "#4a9eff"
                         for v in pf_df["tna"]]
            fig_pf = go.Figure(go.Bar(
                x=pf_df["tna"], y=pf_df["entidad"],
                orientation="h",
                marker_color=pf_colors,
                text=[f"{v:.2f}%" for v in pf_df["tna"]],
                textposition="outside",
                textfont=dict(size=10),
                hovertemplate="%{y}: %{x:.2f}%<extra></extra>",
            ))
            fig_pf.add_vline(x=_ipc_ref, line_dash="dash", line_color="#ff5252",
                             annotation_text=f"Inflación anualiz. ~{_ipc_ref:.0f}%",
                             annotation_position="top right",
                             annotation_font_color="#ff5252")
            fig_pf.update_layout(
                template=DARK, height=430,
                margin=dict(l=10, r=70, t=10, b=30),
                xaxis=dict(title="TNA %", range=[0, pf_df["tna"].max() * 1.18]),
                yaxis=dict(tickfont=dict(size=10)),
                showlegend=False,
            )
            st.plotly_chart(fig_pf, width="stretch")
            st.caption(f"🟢 ≥ inflación anualizada  🟡 cerca  🔵 por debajo · {len(pf_df)} entidades · Fuente: argentinadatos.com")
            _best_pf  = pf_df.iloc[-1]
            _worst_pf = pf_df.iloc[0]
            interp(
                f"Mejor TNA de plazo fijo: {_best_pf['entidad']} con {_best_pf['tna']:.2f}%. "
                f"La más baja es {_worst_pf['entidad']} ({_worst_pf['tna']:.2f}%). "
                f"Con inflación anualizada de referencia ~{_ipc_ref:.0f}%, "
                f"{'ninguna entidad' if _best_pf['tna'] < _ipc_ref else 'solo las marcadas en verde'} "
                f"ofrecen tasa real positiva."
            )
        else:
            st.warning(f"⚠️ Datos de plazo fijo no disponibles. {err_pf or ''}")

    # ─────────────────────────────────────────
    # FILA 4 — Inflación + Tasas de Referencia
    # ─────────────────────────────────────────
    st.markdown('<div class="section-title">Indicadores Macro · Tasas de Referencia</div>',
                unsafe_allow_html=True)
    col_ipc, col_tasas_ref = st.columns(2)

    # ── IPC mensual ──
    with col_ipc:
        st.markdown("**Inflación Mensual IPC (INDEC)**")
        if ipc_rows:
            ipc_df = pd.DataFrame(ipc_rows)
            bar_colors = ["#ff5252" if v >= 3 else "#ffa726" if v >= 2 else "#00c853"
                          for v in ipc_df["ipc_pct"]]
            fig_ipc = go.Figure(go.Bar(
                x=ipc_df["fecha"], y=ipc_df["ipc_pct"],
                marker_color=bar_colors,
                text=[f"{v:.1f}%" for v in ipc_df["ipc_pct"]],
                textposition="outside",
                textfont=dict(size=10),
                hovertemplate="%{x}: %{y:.2f}%<extra></extra>",
            ))
            fig_ipc.add_hline(y=2.0, line_dash="dot", line_color="#ffa726",
                              annotation_text="2%", annotation_font_color="#ffa726",
                              annotation_position="top right")
            fig_ipc.update_layout(
                template=DARK, height=300,
                margin=dict(l=10, r=20, t=20, b=40),
                yaxis_title="Variación mensual %",
                xaxis_title="",
                showlegend=False,
                yaxis=dict(tickformat=".1f", ticksuffix="%"),
            )
            st.plotly_chart(fig_ipc, width="stretch")
            # Interpretación IPC
            _ult_ipc  = ipc_rows[-1]
            _prev_ipc = ipc_rows[-2] if len(ipc_rows) > 1 else None
            _acum_12  = sum(r["ipc_pct"] for r in ipc_rows[-12:])
            _trend_ipc = ""
            if _prev_ipc:
                _d = _ult_ipc["ipc_pct"] - _prev_ipc["ipc_pct"]
                _trend_ipc = f"{'sube' if _d > 0 else 'baja'} {abs(_d):.1f} pp vs mes anterior. "
            interp(
                f"El IPC de {_ult_ipc['fecha']} fue {_ult_ipc['ipc_pct']:.2f}% mensual. "
                f"{_trend_ipc}"
                f"Acumulado 12 meses: {_acum_12:.1f}%. "
                f"Para una empresa, los costos en pesos crecen al mismo ritmo; "
                f"cubrir costos requiere remarcar precios o financiar la diferencia."
            )
            ultimo_ipc = ipc_rows[-1]
            acum_anual = sum(r["ipc_pct"] for r in ipc_rows[-12:])
            st.caption(
                f"Último dato: **{ultimo_ipc['ipc_pct']:.2f}%** ({ultimo_ipc['fecha']}) · "
                f"Acum. 12 meses: **{acum_anual:.1f}%** · Fuente: INDEC vía datos.gob.ar"
            )
        else:
            st.warning("⚠️ Datos IPC no disponibles.")

    # ── Caución + BADLAR ──
    with col_tasas_ref:
        st.markdown("**Caución Overnight y BADLAR — TNA % (6 meses)**")

        fig_tasas_ref = go.Figure()

        if caucion_rows:
            cau_df = pd.DataFrame(caucion_rows)
            fig_tasas_ref.add_trace(go.Scatter(
                x=cau_df["fecha"], y=cau_df["tna"],
                line=dict(color="#0097a7", width=2),
                name="Caución 1d (ROFEX)",
                hovertemplate="Caución %{x}: %{y:.2f}%<extra></extra>",
            ))

        if badlar_rows:
            badlar_df = pd.DataFrame(badlar_rows)
            fig_tasas_ref.add_trace(go.Scatter(
                x=badlar_df["fecha"], y=badlar_df["tna"],
                line=dict(color="#ffa726", width=2, dash="dash"),
                name="BADLAR hist. (datos.gob.ar)",
                hovertemplate="BADLAR %{x}: %{y:.2f}%<extra></extra>",
            ))

        # Punto actual BADLAR del BCRA (puede estar más reciente que el histórico)
        if badlar_val and badlar_fecha:
            try:
                _bf_iso = datetime.strptime(badlar_fecha, "%d/%m/%Y").strftime("%Y-%m-%d")
            except Exception:
                _bf_iso = badlar_fecha
            fig_tasas_ref.add_trace(go.Scatter(
                x=[_bf_iso], y=[badlar_val],
                mode="markers+text",
                marker=dict(color="#ffa726", size=10, symbol="circle",
                            line=dict(color="white", width=2)),
                text=[f"  BCRA {badlar_val:.2f}%"],
                textposition="middle right",
                textfont=dict(color="#ffa726", size=11),
                name=f"BADLAR actual (BCRA {badlar_fecha})",
                hovertemplate=f"BADLAR BCRA {badlar_fecha}: {badlar_val:.2f}%<extra></extra>",
                showlegend=False,
            ))

        if caucion_rows or badlar_rows or badlar_val:
            fig_tasas_ref.update_layout(
                template=DARK, height=300,
                margin=dict(l=40, r=20, t=20, b=40),
                yaxis_title="TNA %",
                xaxis_title="",
                legend=dict(orientation="h", yanchor="bottom", y=1.01, xanchor="left", x=0),
                hovermode="x unified",
                yaxis=dict(tickformat=".1f", ticksuffix="%"),
            )
            st.plotly_chart(fig_tasas_ref, width="stretch")
            _notes = []
            if cau_val:
                _notes.append(f"Caución: **{cau_val:.2f}%** TNA")
            if badlar_val:
                _notes.append(f"BADLAR: **{badlar_val:.2f}%** TNA ({badlar_fecha} · BCRA)")
            if _notes:
                st.caption(" · ".join(_notes))
            if cau_val and badlar_val:
                _spread_cb = cau_val - badlar_val
                interp(
                    f"La caución overnight ({cau_val:.2f}%) está "
                    f"{'por encima' if _spread_cb > 0 else 'por debajo'} de la BADLAR "
                    f"({badlar_val:.2f}%) por {abs(_spread_cb):.2f} pp. "
                    f"La caución es el costo del dinero a 1 día; "
                    f"la BADLAR refleja el fondeo bancario a 30 días."
                )
            elif cau_val:
                interp(f"Caución overnight en {cau_val:.2f}% TNA — referencia del costo del dinero a 1 día.")
        else:
            st.warning("⚠️ Datos de tasas de referencia no disponibles.")

    # ─────────────────────────────────────────
    # FILA 6 — RFX20 histórico
    # ─────────────────────────────────────────
    st.markdown('<div class="section-title">Índice RFX20 · Últimos 6 meses</div>',
                unsafe_allow_html=True)

    if rfx20_rows:
        rfx_df = pd.DataFrame(rfx20_rows)
        fig_rfx = go.Figure()
        fig_rfx.add_trace(go.Scatter(
            x=rfx_df["fecha"], y=rfx_df["valor"],
            line=dict(color="#ef6c00", width=2),
            fill="tozeroy",
            fillcolor="rgba(239,108,0,0.07)",
            name="RFX20",
            hovertemplate="%{x}: %{y:,.0f}<extra></extra>",
        ))
        if rfx_val:
            fig_rfx.add_annotation(
                x=rfx_df["fecha"].iloc[-1], y=rfx_val,
                text=f"  {rfx_val:,.0f}",
                showarrow=True, arrowhead=2,
                font=dict(color="#ef6c00", size=12),
                arrowcolor="#ef6c00",
            )
        fig_rfx.update_layout(
            template=DARK, height=220,
            margin=dict(l=40, r=40, t=10, b=40),
            yaxis_title="Índice", xaxis_title="",
            showlegend=False, hovermode="x",
        )
        st.plotly_chart(fig_rfx, width="stretch")
        if rfx_val and rfx_prev:
            var_rfx = (rfx_val / rfx_prev - 1) * 100
            st.caption(f"RFX20 último: **{rfx_val:,.0f}** · Variación: {var_rfx:+.2f}% · Fuente: Matba-Rofex")
        # Interpretación RFX20
        if rfx20_rows and len(rfx20_rows) > 1:
            _rfx_ini = rfx20_rows[0]["valor"]
            _rfx_fin = rfx20_rows[-1]["valor"]
            _var_6m  = (_rfx_fin / _rfx_ini - 1) * 100 if _rfx_ini else 0
            _ipc_6m  = sum(r["ipc_pct"] for r in ipc_rows[-6:]) if ipc_rows else None
            _vs_inf  = (f" vs inflación acumulada del período ~{_ipc_6m:.1f}%." if _ipc_6m else ".")
            interp(
                f"El RFX20 acumula {_var_6m:+.1f}% en los últimos 6 meses{_vs_inf} "
                f"El índice agrupa los 20 futuros financieros más líquidos de Matba-Rofex "
                f"y es un termómetro del mercado de capitales local en pesos."
            )
    else:
        st.warning("⚠️ Datos RFX20 no disponibles.")

    # ─────────────────────────────────────────
    # FOOTER
    # ─────────────────────────────────────────
    st.markdown("---")
    st.markdown(
        '<div style="font-size:11px; color:#6b7280; text-align:center">'
        'Fuentes: '
        '<a href="https://dolarapi.com" style="color:#4a9eff">dolarapi.com</a> · '
        '<a href="https://argentinadatos.com" style="color:#4a9eff">argentinadatos.com</a> · '
        '<a href="https://apis.datos.gob.ar" style="color:#4a9eff">datos.gob.ar (INDEC/BCRA)</a> · '
        'Matba-Rofex · '
        'Actualización automática cada 60 segundos'
        '</div>',
        unsafe_allow_html=True,
    )


if __name__ == "__main__":
    main()
