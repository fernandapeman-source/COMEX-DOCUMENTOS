# PEMAN — Automatización de Documentos de Comercio Exterior

Genera automáticamente los documentos Excel de exportación completando las plantillas con reglas PEMAN.

## Documentos generados
| Etapa | Documentos |
|-------|-----------|
| Etapa 1 | Packing List Aduana · Proforma |
| Etapa 2 | Resumen de Carga · Packing List Comercial · Declaración de Embarque |
| Etapa 3 | Todos los anteriores |

## Instalación

### 1. Instalar Node.js
Descargar desde https://nodejs.org (versión LTS recomendada).

### 2. Instalar dependencias
```bash
cd "C:\Users\54352\OneDrive\Desktop\IA PRUEBA\Code"
npm install
```

### 3. API Key (opcional — se puede ingresar en la UI)
```bash
copy .env.example .env
# Editar .env y poner tu clave: ANTHROPIC_API_KEY=sk-ant-...
```

### 4. Iniciar la app
```bash
npm start
```
Abrir el navegador en http://localhost:3000

## Uso
1. Ingresar la Anthropic API Key (se guarda en el navegador).
2. Arrastrar los documentos de la operación (PDF, XLSX, DOCX).
3. La etapa se detecta automáticamente; se puede forzar con el selector.
4. Clic en **Generar Documentos**.
5. Descargar los archivos `.xlsx` generados.

## Estructura
```
├── server.js          Servidor Express
├── src/
│   ├── extractor.js   Extracción con Claude API
│   ├── rules.js       Reglas PEMAN
│   └── filler.js      Completado de plantillas Excel
├── templates/         Plantillas .xlsx base
└── public/            Frontend (HTML/CSS/JS)
```
