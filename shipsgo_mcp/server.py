import os
import sys
import httpx
from mcp.server.fastmcp import FastMCP

SHIPSGO_TOKEN = os.environ.get("SHIPSGO_TOKEN", "95871254-f154-4ae9-83ae-f686758cf80c")
BASE_URL = "https://api.shipsgo.com/v2"

_http_port = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[1] == "http" else 8765
mcp = FastMCP("ShipsGo", host="0.0.0.0", port=_http_port)

def _headers():
    return {"X-Shipsgo-User-Token": SHIPSGO_TOKEN}

def _get(path: str, params: dict = None) -> dict:
    r = httpx.get(f"{BASE_URL}{path}", headers=_headers(), params=params, timeout=15, verify=False)
    r.raise_for_status()
    return r.json()


@mcp.tool()
def listar_embarques_maritimos(
    estado: str = None,
    referencia: str = None,
    limite: int = 50,
) -> str:
    """Lista los embarques marítimos (ocean) con sus fechas de arribo estimadas.

    Args:
        estado: Filtrar por estado: SAILING, ARRIVED, DELAYED, etc. (opcional)
        referencia: Filtrar por referencia de operación (opcional)
        limite: Cantidad máxima de resultados (por defecto 50)
    """
    params = {"per_page": limite}
    if estado:
        params["filter[status]"] = estado
    if referencia:
        params["filter[reference]"] = referencia

    data = _get("/ocean/shipments", params)
    shipments = data.get("shipments", [])

    if not shipments:
        return "No se encontraron embarques marítimos."

    lines = [f"{'Referencia':<15} {'Contenedor':<15} {'Naviera':<10} {'Estado':<10} {'Puerto Origen':<20} {'Salida':<22} {'Puerto Destino':<22} {'Arribo Est.':<22}"]
    lines.append("-" * 140)

    for s in shipments:
        route = s.get("route", {})
        pol = route.get("port_of_loading", {})
        pod = route.get("port_of_discharge", {})
        pol_name = pol.get("location", {}).get("name", "-")
        pod_name = pod.get("location", {}).get("name", "-")
        loading_date = pol.get("date_of_loading", "-")[:10] if pol.get("date_of_loading") else "-"
        discharge_date = pod.get("date_of_discharge", "-")[:10] if pod.get("date_of_discharge") else "-"
        carrier = s.get("carrier", {}).get("name", "-")
        lines.append(
            f"{s.get('reference','-'):<15} {s.get('container_number','-'):<15} {carrier:<10} "
            f"{s.get('status','-'):<10} {pol_name:<20} {loading_date:<22} {pod_name:<22} {discharge_date:<22}"
        )

    return "\n".join(lines)


@mcp.tool()
def detalle_embarque_maritimo(id_embarque: int) -> str:
    """Obtiene el detalle completo de un embarque marítimo específico, incluyendo puertos de transbordo y fechas.

    Args:
        id_embarque: ID numérico del embarque (obtenido de listar_embarques_maritimos)
    """
    data = _get(f"/ocean/shipments/{id_embarque}")
    s = data.get("shipment", data)

    route = s.get("route", {})
    pol = route.get("port_of_loading", {})
    pod = route.get("port_of_discharge", {})
    transshipments = route.get("transshipments", [])

    lines = [
        f"=== Embarque {s.get('reference', id_embarque)} ===",
        f"Contenedor:    {s.get('container_number', '-')}",
        f"Booking:       {s.get('booking_number', '-')}",
        f"Naviera:       {s.get('carrier', {}).get('name', '-')} ({s.get('carrier', {}).get('scac', '-')})",
        f"Estado:        {s.get('status', '-')}",
        f"",
        f"Origen:        {pol.get('location', {}).get('name', '-')} ({pol.get('location', {}).get('code', '-')})",
        f"Fecha salida:  {(pol.get('date_of_loading') or '-')[:10]}",
        f"",
        f"Destino:       {pod.get('location', {}).get('name', '-')} ({pod.get('location', {}).get('code', '-')})",
        f"Arribo est.:   {(pod.get('date_of_discharge') or '-')[:10]}",
        f"Arribo inic.:  {(pod.get('date_of_discharge_initial') or '-')[:10]}",
        f"Tránsito:      {route.get('transit_time', '-')} días ({route.get('transit_percentage', 0)}% completado)",
    ]

    if transshipments:
        lines.append("")
        lines.append("Transbordos:")
        for ts in transshipments:
            loc = ts.get("location", {})
            lines.append(f"  - {loc.get('name', '-')} | Arribo: {(ts.get('date_of_arrival') or '-')[:10]} | Salida: {(ts.get('date_of_departure') or '-')[:10]}")

    creator = s.get("creator", {})
    if creator:
        lines.append(f"\nCreado por:    {creator.get('name', '-')} ({creator.get('email', '-')})")

    return "\n".join(lines)


@mcp.tool()
def listar_embarques_aereos(
    estado: str = None,
    referencia: str = None,
    limite: int = 50,
) -> str:
    """Lista los embarques aéreos con sus fechas de arribo estimadas.

    Args:
        estado: Filtrar por estado (opcional)
        referencia: Filtrar por referencia de operación (opcional)
        limite: Cantidad máxima de resultados (por defecto 50)
    """
    params = {"per_page": limite}
    if estado:
        params["filter[status]"] = estado
    if referencia:
        params["filter[reference]"] = referencia

    data = _get("/air/shipments", params)
    shipments = data.get("shipments", [])

    if not shipments:
        return "No se encontraron embarques aéreos."

    lines = [f"{'Referencia':<15} {'AWB':<15} {'Aerolinea':<12} {'Estado':<10} {'Origen':<20} {'Salida':<12} {'Destino':<20} {'Arribo Est.':<12}"]
    lines.append("-" * 120)

    for s in shipments:
        route = s.get("route", {})
        pol = route.get("airport_of_departure", {})
        pod = route.get("airport_of_arrival", {})
        dep_name = pol.get("location", {}).get("name", "-")
        arr_name = pod.get("location", {}).get("name", "-")
        dep_date = (pol.get("date_of_departure") or "-")[:10]
        arr_date = (pod.get("date_of_arrival") or "-")[:10]
        airline = s.get("airline", {}).get("name", "-")
        lines.append(
            f"{s.get('reference','-'):<15} {s.get('awb_number','-'):<15} {airline:<12} "
            f"{s.get('status','-'):<10} {dep_name:<20} {dep_date:<12} {arr_name:<20} {arr_date:<12}"
        )

    return "\n".join(lines)


@mcp.tool()
def resumen_operaciones_comercio_exterior() -> str:
    """Genera un resumen ejecutivo de todas las operaciones activas de comercio exterior:
    embarques marítimos y aéreos, con énfasis en arribos próximos y estados críticos."""

    ocean_data = _get("/ocean/shipments", {"per_page": 100})
    air_data = _get("/air/shipments", {"per_page": 100})

    ocean = ocean_data.get("shipments", [])
    air = air_data.get("shipments", [])

    from datetime import datetime, timezone

    hoy = datetime.now(timezone.utc).date()

    def days_to_arrival(date_str):
        if not date_str or date_str == "-":
            return None
        try:
            d = datetime.fromisoformat(date_str).date()
            return (d - hoy).days
        except Exception:
            return None

    lines = ["=" * 60, "RESUMEN DE OPERACIONES DE COMERCIO EXTERIOR", f"Fecha: {hoy}", "=" * 60]

    # Ocean summary
    lines.append(f"\n📦 EMBARQUES MARÍTIMOS ({len(ocean)} total)")
    lines.append("-" * 40)

    critical = []
    upcoming = []
    sailing = []
    arrived = []

    for s in ocean:
        route = s.get("route", {})
        pod = route.get("port_of_discharge", {})
        disc_date = pod.get("date_of_discharge")
        disc_initial = pod.get("date_of_discharge_initial")
        days = days_to_arrival(disc_date)
        days_initial = days_to_arrival(disc_initial)
        delayed = days is not None and days_initial is not None and days > days_initial

        info = {
            "ref": s.get("reference", "-"),
            "container": s.get("container_number", "-"),
            "carrier": s.get("carrier", {}).get("name", "-"),
            "status": s.get("status", "-"),
            "origin": route.get("port_of_loading", {}).get("location", {}).get("name", "-"),
            "dest": pod.get("location", {}).get("name", "-"),
            "arrival": (disc_date or "-")[:10],
            "days": days,
            "delayed": delayed,
        }

        if s.get("status") == "ARRIVED":
            arrived.append(info)
        elif days is not None and days <= 7:
            critical.append(info)
        elif days is not None and days <= 30:
            upcoming.append(info)
        else:
            sailing.append(info)

    def format_ocean(items, label):
        if not items:
            return
        lines.append(f"\n{label}:")
        for i in items:
            delay_tag = " ⚠️ DEMORADO" if i["delayed"] else ""
            days_str = f"({i['days']} días)" if i["days"] is not None else ""
            lines.append(f"  • {i['ref']} | {i['container']} | {i['carrier']}")
            lines.append(f"    {i['origin']} → {i['dest']} | Arribo: {i['arrival']} {days_str}{delay_tag}")

    format_ocean(critical, "🔴 ARRIBO EN ≤7 DÍAS")
    format_ocean(upcoming, "🟡 ARRIBO EN 8-30 DÍAS")
    format_ocean(arrived, "✅ ARRIBADOS RECIENTEMENTE")
    format_ocean(sailing, "🔵 EN TRÁNSITO")

    # Air summary
    if air:
        lines.append(f"\n✈️  EMBARQUES AÉREOS ({len(air)} total)")
        lines.append("-" * 40)
        for s in air:
            route = s.get("route", {})
            arr = route.get("airport_of_arrival", {})
            arr_date = (arr.get("date_of_arrival") or "-")[:10]
            days = days_to_arrival(arr.get("date_of_arrival"))
            days_str = f"({days} días)" if days is not None else ""
            lines.append(f"  • {s.get('reference','-')} | AWB: {s.get('awb_number','-')} | {s.get('status','-')}")
            lines.append(f"    Destino: {arr.get('location',{}).get('name','-')} | Arribo: {arr_date} {days_str}")

    lines.append("\n" + "=" * 60)
    return "\n".join(lines)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "stdio"
    if mode == "http":
        mcp.run(transport="streamable-http")
    else:
        mcp.run(transport="stdio")
