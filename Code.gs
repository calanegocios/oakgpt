/**
 * OAKGPT — Piloto Oakberry Chacarilla (Grupo CALA)
 * Verifica con IA que cada pedido delivery salga completo antes de cerrar la bolsa.
 *
 * Propiedades del script que hay que crear (Configuración del proyecto → Propiedades de secuencia de comandos):
 *   GEMINI_API_KEY  → clave de Google AI Studio
 *   PIN             → PIN de 4 dígitos que usará el celular de la estación
 * Luego ejecutar setup() una sola vez.
 */

// ==================== CONFIGURACIÓN ====================
const CONFIG = {
  LOCAL: 'Oakberry Chacarilla',
  // Se prueban en orden: si el primero está saturado o no existe, pasa al siguiente
  MODELOS: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'],
  ZONA_HORARIA: 'America/Lima',
  CARPETA_PRINCIPAL: 'Fotocheck',
  MAX_LOTE: 12,               // máximo de fotos por envío en modo lote
  NIVEL_RAZONAMIENTO: 'low',
  NIVEL_RAZONAMIENTO_AGRUPAR: 'medium', // emparejar comandas con vasos pide un poco más de análisis // 'low' = más rápido; subir a 'medium' si se equivoca mucho
  MAX_TOPPINGS_CONFIABLE: 6, // más de esto, las capas se mezclan → revisión manual
};

// ==================== CARTA RAPPI CHACARILLA ====================
const CARTA = {
  bowls_acai: [
    'Acai Bowl One (tamaño chico) — toppings a elección',
    'Acai bowl classic (12 oz) — toppings a elección',
    'Acai Bowl Works (16 oz) — toppings a elección',
    'Acai Bowl The Oak (24 oz) — toppings a elección',
  ],
  signature_bowls: {
    'Tiger': ['proteína a elección', 'granola', 'mantequilla de maní', 'fresa (doble)'],
    'Matcha': ['matcha chia pudding (doble)', 'fresa (doble)', 'miel'],
    'Golden almonds': ['mantequilla de almendras', 'leche en polvo', 'almendras', 'fresa', 'arándanos'],
    'Fruity': ['granola (doble)', 'plátano', 'fresa', 'maracuyá'],
    'Crunchy': ['chia pudding', 'granola', 'fresa', 'arándanos'],
    'Original': ['granola', 'mantequilla de maní', 'plátano'],
    'Tropical Bowl': ['mantequilla de maní', 'fresa', 'maracuyá', 'chia pudding'],
    'Snow Bowl': ['arándanos', 'plátano', 'mantequilla de maní', 'coco', 'leche condensada', 'leche en polvo', 'blue pudding'],
  },
  smoothies: [
    'Smoothie Classic (12 oz) + toppings', 'Smoothie Works (16 oz) + toppings', 'Smoothie The Oak (24 oz) + toppings',
    'Smoothie Very Berry', 'Smoothie Choco Punch', 'Smoothie Super Glow', 'Smoothie Tropical Beats',
    'Smoothie Zen Matcha', 'Smoothie Blue Fairy',
    'Booster Strawberry glow', 'Booster Hyper monkey', 'Booster Mango tango', 'Booster Matcha power', 'Booster Blue magic',
  ],
  baldes: ['Family Pack 7KG', 'Personal Bucket 1kg', 'Combo Personal Bucket (1kg + 3 toppings)'],
  toppings: [
    'Cashews', 'Avena', 'Granola Vainilla & Pecanas', 'Cacao Nibs', 'Cacao en Polvo', 'Maní', 'Coco', 'Mango',
    'Maracuyá', 'Pitahaya', 'Granola Cranberries & Canela', 'Plátano', 'Miel', 'Maca en Polvo',
    'Granola Nueces & Semillas', 'Algarrobina en Polvo', 'Chía', 'Semillas de Girasol', 'Leche Condensada',
    'Lúcuma en Polvo', 'Almendras', 'Pasas', 'Leche en Polvo', 'Aguaymanto', 'Granola Choco - Cañihua Pop',
    'Arándanos', 'Fresa', 'Arándanos Deshidratados', 'Mantequilla de Maní', 'Castañas', 'Chia Pudding', 'Uva', 'Kiwi',
    'Crema de Pistacho',
  ],
  extras: [
    'Epic Protein - Pro Colágeno', 'Epic Protein - Vainilla Lúcuma', 'Epic Protein - Maca Chocolate',
    'Mantequilla de Almendras',
  ],
};

// Pistas visuales que dio Alex (agregar aquí lo que se vaya aprendiendo)
const PISTAS_VISUALES = [
  'Granola Cranberries & Canela: tiene un polvito marrón (canela) y cranberries deshidratados visibles.',
  'Granola Choco - Cañihua Pop: tiene bolitas de chocolate.',
  'Granola Vainilla & Pecanas: sin bolitas y sin canela; se confunde fácil con avena.',
  'Granola Nueces & Semillas: (pista pendiente).',
  'Avena: hojuelas planas y sueltas, de color claro; la granola, en cambio, va en racimos tostados.',
  'Crema de Pistacho: crema espesa de color verde claro.',
];

// ==================== WEB APP ====================
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('OakGPT')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

function verificarPin(pin) {
  const pinGuardado = PropertiesService.getScriptProperties().getProperty('PIN');
  return !!pinGuardado && String(pin) === String(pinGuardado);
}

/**
 * Entrada para la página de OakGPT en GitHub (ahí sí se puede usar la cámara en vivo).
 * Recibe { accion: 'verificarPin' | 'procesarLote', pin, fotos } y responde JSON.
 */
function doPost(e) {
  let salida;
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.accion === 'verificarPin') salida = { ok: verificarPin(d.pin) };
    else if (d.accion === 'procesarLote') salida = { ok: true, r: procesarLote(d.pin, d.fotos || []) };
    else salida = { ok: false, error: 'Acción desconocida' };
  } catch (err) {
    salida = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(salida)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Llamada desde el celular.
 * comanda: foto (base64 JPEG) de la pantalla o ticket con el detalle de la orden.
 * pedido: lista de 1 a 3 fotos (base64 JPEG) del pedido armado.
 */
function procesarFoto(pin, comanda, pedido, numeroManual) {
  const inicio = Date.now();
  if (!verificarPin(pin)) throw new Error('PIN incorrecto');
  if (!comanda) throw new Error('Falta la foto de la comanda');
  if (!Array.isArray(pedido) || !pedido.length) throw new Error('Falta la foto del pedido');
  pedido = pedido.slice(0, 3);

  const props = PropertiesService.getScriptProperties();
  const carpetaFotos = DriveApp.getFolderById(props.getProperty('CARPETA_FOTOS_ID'));
  const hoja = SpreadsheetApp.openById(props.getProperty('HOJA_ID')).getSheetByName('Registro');

  const ahora = new Date();
  const fecha = Utilities.formatDate(ahora, CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');
  const hora = Utilities.formatDate(ahora, CONFIG.ZONA_HORARIA, 'HH:mm:ss');
  const base = fecha + '_' + hora.replace(/:/g, '');

  // 1. Guardar las fotos primero (si la IA falla, igual queda la evidencia)
  const guardar = function (b64, sufijo) {
    return carpetaFotos.createFile(
      Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', base + '_' + sufijo + '.jpg'));
  };
  const archivoComanda = guardar(comanda, 'comanda');
  const archivosPedido = pedido.map(function (b64, i) { return guardar(b64, 'pedido' + (i + 1)); });

  // 2. Revisar con la IA
  let r;
  try {
    const ia = llamarGemini(comanda, pedido);
    r = normalizarResultado(ia);
    r.modelo = ia.modelo;
  } catch (e) {
    r = {
      numero_pedido: null, productos: [], faltantes: [], dudosos: [],
      resultado: 'ERROR_IA', mensaje_corto: 'La IA está saturada. Las fotos quedaron guardadas: reintenta en un momento o revisa a mano.',
      detalle_error: String(e.message || e),
    };
  }

  const numero = (numeroManual && String(numeroManual).trim()) || r.numero_pedido || '';
  if (numero) {
    archivoComanda.setName(base + '_' + numero + '_comanda.jpg');
    archivosPedido.forEach(function (a, i) { a.setName(base + '_' + numero + '_pedido' + (i + 1) + '.jpg'); });
  }

  // 3. Registrar
  hoja.appendRow([
    fecha, hora, CONFIG.LOCAL, numero ? "'" + numero : '', r.resultado,
    r.productos.map(function (p) { return p.nombre_ticket; }).join(' | '),
    r.faltantes.join(', '), r.dudosos.join(', '),
    r.cuchara_pedida === true ? 'Sí' : (r.cuchara_pedida === false ? 'No' : ''),
    r.mensaje_corto, archivoComanda.getUrl(),
    archivosPedido.map(function (a) { return a.getUrl(); }).join('\n'),
    JSON.stringify(r),
    Math.round((Date.now() - inicio) / 100) / 10, r.modelo || '',
  ].map(comoTexto));   // textos que empiezan con + = - @ no se leen como fórmula

  return {
    resultado: r.resultado,
    mensaje: r.mensaje_corto,
    numero: numero,
    faltantes: r.faltantes,
    dudosos: r.dudosos,
  };
}

/**
 * Modo lote: fotos sueltas de comandas y vasos, ordenadas por hora de toma.
 * La IA dice qué es cada foto y empareja cada comanda con sus vasos por contenido (no por orden);
 * luego cada pedido se revisa a ciegas, todos a la vez.
 */
function procesarLote(pin, fotos) {
  const inicio = Date.now();
  if (!verificarPin(pin)) throw new Error('PIN incorrecto');
  if (!Array.isArray(fotos) || !fotos.length) throw new Error('No hay fotos');
  fotos = fotos.slice(0, CONFIG.MAX_LOTE);

  const props = PropertiesService.getScriptProperties();
  const carpetaFotos = DriveApp.getFolderById(props.getProperty('CARPETA_FOTOS_ID'));
  const hoja = SpreadsheetApp.openById(props.getProperty('HOJA_ID')).getSheetByName('Registro');
  const ahora = new Date();
  const fecha = Utilities.formatDate(ahora, CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');
  const hora = Utilities.formatDate(ahora, CONFIG.ZONA_HORARIA, 'HH:mm:ss');
  const base = fecha + '_' + hora.replace(/:/g, '');

  // 1. Guardar todas las fotos primero: la evidencia queda aunque la IA falle
  const archivos = fotos.map(function (b64, i) {
    return carpetaFotos.createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', base + '_lote_' + (i + 1) + '.jpg'));
  });
  const fila = function (numero, r, urlComanda, urlsPedido) {
    hoja.appendRow([
      fecha, hora, CONFIG.LOCAL, numero ? "'" + numero : '', r.resultado,
      (r.productos || []).map(function (p) { return p.nombre_ticket; }).join(' | '),
      (r.faltantes || []).join(', '), (r.dudosos || []).join(', '),
      r.cuchara_pedida === true ? 'Sí' : (r.cuchara_pedida === false ? 'No' : ''),
      r.mensaje_corto, urlComanda || '', (urlsPedido || []).join('\n'), JSON.stringify(r),
      Math.round((Date.now() - inicio) / 100) / 10, r.modelo || '',
    ].map(comoTexto));
  };
  const errorIA = function (detalle) {
    return { productos: [], faltantes: [], dudosos: [], resultado: 'ERROR_IA',
      mensaje_corto: 'La IA no pudo revisar este lote. Las fotos quedaron guardadas.', detalle_error: String(detalle) };
  };

  // 2. Clasificar y agrupar por contenido
  let tipos;
  const key = claveGemini();
  try { tipos = agruparFotos(key, fotos); }
  catch (e) {
    fila('', errorIA(e.message || e), '', archivos.map(function (a) { return a.getUrl(); }));
    return { fotos: fotos.length, pedidos: 0, resultados: [{ resultado: 'ERROR_IA', mensaje: 'La IA no pudo revisar el lote; las fotos quedaron guardadas.' }] };
  }

  // 3. Armar los grupos: cada comanda con los vasos que la IA le asignó (estén antes o después)
  const grupos = [];
  const porComanda = {};
  tipos.forEach(function (t, i) {
    if (t.tipo === 'comanda') { porComanda[i] = { comanda: i, numero: t.numero, pedido: [] }; grupos.push(porComanda[i]); }
  });
  const sueltos = { comanda: null, numero: '', pedido: [] };
  tipos.forEach(function (t, i) {
    if (t.tipo !== 'pedido') return;
    if (t.comanda !== null && porComanda[t.comanda]) porComanda[t.comanda].pedido.push(i);
    else sueltos.pedido.push(i);
  });
  if (sueltos.pedido.length) grupos.push(sueltos);
  const otras = tipos.map(function (t, i) { return t.tipo === 'otro' ? i : -1; }).filter(function (i) { return i >= 0; });

  // 4. Revisar todos los pedidos completos a la vez
  const payloads = [];
  grupos.forEach(function (g) {
    if (g.comanda === null || !g.pedido.length) return;
    g.idx = payloads.length;
    Array.prototype.push.apply(payloads, payloadsRevision(fotos[g.comanda], g.pedido.slice(0, CONFIG.MAX_LOTE).map(function (i) { return fotos[i]; })));
  });
  let resps = null, fallo = '';
  if (payloads.length) { try { resps = llamarEnParalelo(key, payloads); } catch (e) { fallo = e.message || e; } }

  // 5. Registrar cada pedido
  const resultados = [];
  grupos.forEach(function (g) {
    let r;
    if (g.comanda === null) r = { productos: [], faltantes: [], dudosos: [], resultado: 'SIN_TICKET', mensaje_corto: 'Vasos que no corresponden a ninguna comanda del lote.' };
    else if (!g.pedido.length) r = { productos: [], faltantes: [], dudosos: [], resultado: 'FOTO_PEDIDO', mensaje_corto: 'Comanda sin foto de sus vasos en el lote.' };
    else if (!resps) r = errorIA(fallo);
    else {
      try {
        const ia = { comanda: extraerJson(resps[g.idx].resp), pedido: extraerJson(resps[g.idx + 1].resp),
          modelo: resps[g.idx].modelo + ' / ' + resps[g.idx + 1].modelo };
        r = normalizarResultado(ia);
        r.modelo = ia.modelo;
      } catch (e) { r = errorIA(e.message || e); }
    }
    const numero = r.numero_pedido || g.numero || '';
    if (g.comanda !== null) archivos[g.comanda].setName(base + '_' + (numero || 'sin-numero') + '_comanda.jpg');
    g.pedido.forEach(function (i, k) { archivos[i].setName(base + '_' + (numero || 'sin-numero') + '_pedido' + (k + 1) + '.jpg'); });
    fila(numero, r, g.comanda !== null ? archivos[g.comanda].getUrl() : '', g.pedido.map(function (i) { return archivos[i].getUrl(); }));
    resultados.push({ numero: numero, resultado: r.resultado, mensaje: r.mensaje_corto, faltantes: r.faltantes || [], dudosos: r.dudosos || [] });
  });
  if (otras.length) {
    fila('', { productos: [], faltantes: [], dudosos: [], resultado: 'OTRO', mensaje_corto: otras.length + ' foto(s) que no eran comanda ni pedido.' },
      '', otras.map(function (i) { return archivos[i].getUrl(); }));
  }
  return { fotos: fotos.length, pedidos: grupos.filter(function (g) { return g.comanda !== null; }).length, resultados: resultados };
}

function comoTexto(v) {
  return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
}

// ==================== IA (revisión a ciegas) ====================
// Dos consultas en paralelo: una lee SOLO la comanda; la otra mira SOLO el pedido, sin saber qué se pidió.
// La comparación la hace el código con reglas fijas, para que la IA no "vea" lo que espera ver.

// Toppings que casi no se ven en foto: si no aparecen, se marcan "revisar", nunca "falta"
const DIFICILES_DE_VER = ['miel', 'leche condensada', 'cacao en polvo', 'maca en polvo', 'algarrobina en polvo',
  'lucuma en polvo', 'leche en polvo', 'chia', 'semillas de girasol', 'cacao nibs', 'proteina a eleccion'];

function promptComanda() {
  return [
    'Lee esta foto de la COMANDA de un pedido de Rappi de ' + CONFIG.LOCAL + '. Puede ser una pantalla fotografiada, inclinada o con reflejos.',
    'Transcribe exactamente lo que dice, sin inventar ni completar nada.',
    'Para cada producto: nombre tal cual, cantidad, y sus toppings y extras tal cual aparecen.',
    'Clasifica cada producto en "tipo": "bowl" (Acai bowl one / classic / works / the oak), "signature" (Tiger, Matcha, Golden almonds, Fruity, Crunchy, Original, Tropical Bowl, Snow Bowl), "smoothie" (smoothies y boosters), "balde" u "otro".',
    'No pongas como topping las respuestas a "¿Deseas Cuchara?" ni "Dedicatoria".',
    'La comanda puede ser de Rappi o del POS de la tienda (toppings con "+" delante, en mayúsculas o abreviados): transcríbelos igual, tal cual.',
    'cuchara_pedida: true si respondió que sí quiere cuchara, false si respondió que no, null si no aparece.',
    'Si no se puede leer, ticket_legible = false.',
    'Responde SOLO con este JSON:',
    '{"numero_pedido":"2266258429","ticket_legible":true,"productos":[{"nombre":"","cantidad":1,"tipo":"bowl","toppings":[],"extras":[]}],"cuchara_pedida":false}',
  ].join('\n');
}

function promptPedido() {
  const nombres = CARTA.toppings.concat(CARTA.extras,
    ['Blue Pudding', 'Matcha Chia Pudding', 'Granola (tipo no identificado)', 'Granola o avena']);
  return [
    'Eres inspector de calidad de ' + CONFIG.LOCAL + ' (açaí). NO sabes qué pidió el cliente: describe SOLO lo que VES.',
    'Las fotos muestran el pedido armado antes de cerrar la bolsa. Un mismo vaso puede salir en varias fotos: no lo cuentes dos veces.',
    'Los bowls van en vaso transparente: açaí morado oscuro en capas, con toppings ENTRE las capas (se ven de costado) y 1 o 2 toppings de cierre arriba.',
    'Para cada vaso indica: tipo ("bowl", "smoothie", "balde", "otro"), tamaño aproximado ("12oz", "16oz", "24oz" o "?") y cada topping que identifiques con nombre, confianza y evidencia.',
    'REGLAS DE HONESTIDAD:',
    '- Lista un topping SOLO si ves evidencia concreta en la imagen. Si no lo ves, no lo pongas.',
    '- "evidencia" = qué ves exactamente (color, forma, textura, en qué capa).',
    '- confianza "alta" solo si es inconfundible; "media" si es muy probable; "baja" si es una suposición.',
    '- Si ves granola pero no distingues cuál es, usa "Granola (tipo no identificado)". Si no sabes si es granola o avena, usa "Granola o avena".',
    '- Usa EXACTAMENTE uno de estos nombres: ' + nombres.join(', ') + '. Si ves un topping que no está en la lista, ponle un nombre corto y claro.',
    'PISTAS VISUALES:',
    PISTAS_VISUALES.map(function (p) { return '- ' + p; }).join('\n'),
    'Indica también: cuchara_vista (true, false o null si no se puede saber), capas_mezcladas (true si los toppings están revueltos y no se distinguen capas) y foto_util (false si las fotos están borrosas o no muestran el pedido).',
    'Responde SOLO con este JSON:',
    '{"foto_util":true,"vasos":[{"tipo":"bowl","tamano":"12oz","toppings":[{"nombre":"","confianza":"alta","evidencia":""}]}],"cuchara_vista":null,"capas_mezcladas":false}',
  ].join('\n');
}

function claveGemini() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('Falta GEMINI_API_KEY en las propiedades del script');
  return key;
}
function cfgGemini() {
  return { responseMimeType: 'application/json', temperature: 0.1,
    thinkingConfig: { thinkingLevel: CONFIG.NIVEL_RAZONAMIENTO } };
}

function llamarGemini(comanda, pedido) {
  const key = claveGemini();
  const resps = llamarEnParalelo(key, payloadsRevision(comanda, pedido));
  return { comanda: extraerJson(resps[0].resp), pedido: extraerJson(resps[1].resp),
    modelo: resps.map(function (x) { return x.modelo; }).join(' / ') };
}

/** Las dos consultas a ciegas de un pedido: una lee la comanda y otra mira los vasos. */
function payloadsRevision(comanda, pedido) {
  const cfg = cfgGemini();
  const payloadComanda = {
    contents: [{ role: 'user', parts: [
      { text: promptComanda() },
      { inline_data: { mime_type: 'image/jpeg', data: comanda } },
    ] }],
    generationConfig: cfg,
  };
  const partesPedido = [{ text: promptPedido() }];
  pedido.forEach(function (b64, i) {
    partesPedido.push({ text: 'FOTO ' + (i + 1) + ':' });
    partesPedido.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } });
  });
  const payloadPedido = { contents: [{ role: 'user', parts: partesPedido }], generationConfig: cfg };
  return [payloadComanda, payloadPedido];
}

/**
 * Agrupa un lote de fotos sueltas por pedido, POR CONTENIDO: lee cada comanda y le asigna los vasos que
 * coinciden (tamaño, toppings visibles), sin importar si se tomaron antes o después. El orden de toma
 * solo desempata. La revisión de faltantes se hace después, a ciegas, por cada grupo.
 */
function agruparFotos(key, fotos) {
  const partes = [{ text: [
    'Estas ' + fotos.length + ' fotos se tomaron en la estación de empaque de ' + CONFIG.LOCAL + ' (franquicia de açaí). Van numeradas en el orden en que se tomaron, pero NO hay un orden fijo: un vaso puede estar antes o después de su comanda.',
    'TAREA:',
    '1. Clasifica cada foto: "comanda" (pantalla o ticket con el detalle de un pedido: número de orden, productos y toppings), "pedido" (vasos o bowls de açaí, smoothies, baldes o bolsa armada) u "otro" (borrosa, piso, manos, etc.).',
    '2. Para cada comanda, lee el número de pedido (sin #) si se ve.',
    '3. Asigna cada foto de "pedido" a la comanda que le corresponde comparando: cantidad y tamaño de vasos (One/Classic 12 oz chico, Works 16 oz mediano, The Oak 24 oz grande), tipo de producto (bowl, smoothie, balde) y toppings visibles contra los de la comanda.',
    '   - Un vaso puede tener algún topping de menos (eso se revisa después): asígnalo a la comanda que MÁS se parezca.',
    '   - Si solo hay una comanda, todos los vasos van a esa comanda.',
    '   - Si dos comandas se parecen, desempata con la cercanía en el orden de las fotos.',
    '   - Si un vaso no se parece a ninguna comanda, pon "comanda": null.',
    'Responde SOLO con este JSON, una entrada por foto, en el mismo orden:',
    '{"fotos":[{"foto":1,"tipo":"pedido","comanda":2},{"foto":2,"tipo":"comanda","numero_pedido":"2266258429"},{"foto":3,"tipo":"otro"}]}',
  ].join('\n') }];
  fotos.forEach(function (b64, i) {
    partes.push({ text: 'FOTO ' + (i + 1) + ':' });
    partes.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } });
  });
  const cfg = cfgGemini();
  cfg.thinkingConfig = { thinkingLevel: CONFIG.NIVEL_RAZONAMIENTO_AGRUPAR };
  const r = llamarEnParalelo(key, [{ contents: [{ role: 'user', parts: partes }], generationConfig: cfg }])[0];
  const lista = (extraerJson(r.resp).fotos || []);
  const info = fotos.map(function (_, i) {
    const f = lista.filter(function (x) { return Number(x.foto) === i + 1; })[0] || lista[i] || {};
    const tipo = ['comanda', 'pedido'].indexOf(f.tipo) >= 0 ? f.tipo : 'otro';
    return { tipo: tipo, numero: f.numero_pedido ? String(f.numero_pedido).replace('#', '').trim() : '',
      comanda: f.comanda == null ? null : Number(f.comanda) - 1 };
  });
  // Seguridad: la comanda asignada debe existir y ser comanda; si no, el vaso queda sin comanda
  const comandas = info.map(function (x, i) { return x.tipo === 'comanda' ? i : -1; }).filter(function (i) { return i >= 0; });
  info.forEach(function (x) {
    if (x.tipo !== 'pedido') return;
    if (x.comanda === null || !info[x.comanda] || info[x.comanda].tipo !== 'comanda') x.comanda = comandas.length === 1 ? comandas[0] : null;
  });
  return info;
}

/** Lanza todas las consultas a la vez con el primer modelo; las que fallen por saturación van al respaldo. */
function llamarEnParalelo(key, payloads) {
  const modelo = CONFIG.MODELOS[0];
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelo + ':generateContent';
  const pedidos = payloads.map(function (p) {
    return {
      url: url, method: 'post', contentType: 'application/json',
      headers: { 'x-goog-api-key': key }, payload: JSON.stringify(p), muteHttpExceptions: true,
    };
  });
  return UrlFetchApp.fetchAll(pedidos).map(function (r, i) {
    const code = r.getResponseCode();
    if (code === 200) return { resp: r, modelo: modelo };
    // Si el modelo no acepta el nivel de razonamiento, se reintenta sin él
    if (code === 400 && /thinking/i.test(r.getContentText())) return llamarConRespaldo(key, sinRazonamiento(payloads[i]));
    if (code === 404 || code === 429 || code >= 500) return llamarConRespaldo(key, payloads[i]);
    throw new Error(modelo + ' respondió ' + code + ': ' + r.getContentText().slice(0, 200));
  });
}

function sinRazonamiento(p) {
  const copia = JSON.parse(JSON.stringify(p));
  if (copia.generationConfig) delete copia.generationConfig.thinkingConfig;
  return copia;
}

function extraerJson(resp) {
  const data = JSON.parse(resp.getContentText());
  const partes = (((data.candidates || [])[0] || {}).content || {}).parts;
  if (!partes || !partes.length) throw new Error('Respuesta vacía de Gemini');
  const crudo = partes.map(function (p) { return p.text || ''; }).join('');
  return JSON.parse(crudo.replace(/```json|```/g, '').trim());
}

// ==================== COMPARACIÓN (reglas fijas) ====================
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(doble\)|\bdoble\b|\b\d+\s*x\b/g, '')
    .replace(/&/g, ' y ').replace(/[+*•·]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** ¿"a" y "b" son el mismo topping? Tolera abreviaturas del POS: "granola vainilla y pec" = "granola vainilla y pecanas". */
function coincide(a, b) {
  const ignorar = ['y', 'de', 'con', 'la', 'el'];
  const ta = a.split(' ').filter(function (t) { return t && ignorar.indexOf(t) < 0; });
  const tb = b.split(' ').filter(function (t) { return t && ignorar.indexOf(t) < 0; });
  if (!ta.length || !tb.length) return false;
  const dentro = function (x, y) {
    return x.every(function (t) { return y.some(function (u) { return u.indexOf(t) === 0 || (t.indexOf(u) === 0 && u.length >= 3); }); });
  };
  return ta.length <= tb.length ? dentro(ta, tb) : dentro(tb, ta);
}

/** Lleva un topping de la comanda al nombre de la carta, si existe. */
function aNombreCarta(n) {
  const carta = CARTA.toppings.concat(CARTA.extras, ['Blue Pudding', 'Matcha Chia Pudding']).map(norm);
  if (carta.indexOf(n) >= 0) return { n: n, enCarta: true };
  if (n === 'granola' || n === 'proteina a eleccion') return { n: n, enCarta: true };
  const candidatos = carta.filter(function (c) { return coincide(n, c); });
  if (candidatos.length === 1) return { n: candidatos[0], enCarta: true };
  // Varios candidatos (ej. "granola vainilla"): el que tenga más palabras en común
  if (candidatos.length > 1) {
    const puntos = function (c) { return c.split(' ').filter(function (t) { return n.split(' ').indexOf(t) >= 0; }).length; };
    candidatos.sort(function (x, y) { return puntos(y) - puntos(x); });
    if (puntos(candidatos[0]) > puntos(candidatos[1])) return { n: candidatos[0], enCarta: true };
  }
  return { n: n, enCarta: false };
}
const esGranolaGenerica = function (n) { return n === 'granola (tipo no identificado)' || n === 'granola o avena'; };
const esDificil = function (n) {
  return DIFICILES_DE_VER.indexOf(n) >= 0 || n.indexOf('protein') >= 0 || n.indexOf('colageno') >= 0;
};
const IGNORAR = ['no', 'si', 'no agregar', 'sin toppings'];

/** Toppings que debería llevar un producto según la comanda (y la receta si es signature). */
function toppingsEsperados(p) {
  let lista = [].concat(p.toppings || [], p.extras || []);
  if (p.tipo === 'signature') {
    const nombre = norm(p.nombre);
    Object.keys(CARTA.signature_bowls).forEach(function (k) {
      if (nombre.indexOf(norm(k)) >= 0) lista = CARTA.signature_bowls[k].concat(lista);
    });
  }
  const vistos = {};
  const out = [];
  lista.forEach(function (original) {
    const crudo = norm(original);
    if (!crudo || IGNORAR.indexOf(crudo) >= 0 || crudo.indexOf('cuchara') >= 0 || crudo.indexOf('dedicatoria') >= 0) return;
    const c = aNombreCarta(crudo);
    if (vistos[c.n]) return;
    vistos[c.n] = true;
    const etiqueta = String(original).replace(/\(doble\)/gi, '').replace(/^[\s+*•·-]+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
    out.push({ n: c.n, enCarta: c.enCarta, etiqueta: etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1) });
  });
  // Si la comanda ya dice qué proteína eligió, no pedir además la genérica de la receta
  const eligioProteina = out.some(function (t) { return t.n !== 'proteina a eleccion' && (t.n.indexOf('protein') >= 0 || t.n.indexOf('colageno') >= 0); });
  return eligioProteina ? out.filter(function (t) { return t.n !== 'proteina a eleccion'; }) : out;
}

/** Compara un topping esperado contra lo visto. Devuelve 'ok', 'revisar' (con motivo) o 'falta'. */
function evaluar(esperado, vistos, enCarta) {
  const conf = function (v) { return v.confianza === 'alta' || v.confianza === 'media'; };
  const exacto = vistos.filter(function (v) { return v.n === esperado || (enCarta === false && coincide(esperado, v.n)); });
  if (enCarta === false) {
    if (exacto.some(conf)) return { estado: 'ok' };
    return { estado: 'revisar', motivo: 'topping que el sistema no conoce, confirmar' };
  }
  const granolas = vistos.filter(function (v) { return v.n.indexOf('granola') >= 0; });

  if (esperado.indexOf('granola') >= 0 || esperado === 'avena') {
    const generico = esperado === 'granola';
    if (exacto.some(conf)) return { estado: 'ok' };
    if (generico && granolas.some(function (v) { return conf(v) && v.n !== 'granola o avena'; })) return { estado: 'ok' };
    if (esperado === 'avena') {
      if (granolas.length) return { estado: 'revisar', motivo: 'confirmar que sea avena' };
      return { estado: 'falta' };
    }
    if (exacto.length) return { estado: 'revisar', motivo: 'no se ve claro' };
    if (granolas.some(function (v) { return esGranolaGenerica(v.n); })) return { estado: 'revisar', motivo: 'confirmar tipo de granola' };
    if (granolas.length) return { estado: 'revisar', motivo: 'parece otra granola' };
    if (vistos.some(function (v) { return v.n === 'avena'; })) return { estado: 'revisar', motivo: 'se ve avena, confirmar' };
    return { estado: 'falta' };
  }
  if (exacto.some(conf)) return { estado: 'ok' };
  if (exacto.length) return { estado: 'revisar', motivo: 'no se ve claro' };
  if (esDificil(esperado)) return { estado: 'revisar', motivo: 'difícil de ver en foto' };
  return { estado: 'falta' };
}

function normalizarResultado(ia) {
  const c = ia.comanda || {};
  const v = ia.pedido || {};
  const productos = Array.isArray(c.productos) ? c.productos : [];
  const vasos = Array.isArray(v.vasos) ? v.vasos : [];
  const faltantes = [];
  const dudosos = [];

  const base = {
    numero_pedido: c.numero_pedido ? String(c.numero_pedido).replace('#', '').trim() : null,
    productos: productos.map(function (p) { return { nombre_ticket: p.nombre }; }),
    cuchara_pedida: c.cuchara_pedida,
    ia: ia,
  };

  if (c.ticket_legible === false || !productos.length) {
    return Object.assign(base, { faltantes: [], dudosos: [], resultado: 'SIN_TICKET', mensaje_corto: MENSAJES.SIN_TICKET });
  }
  if (v.foto_util === false || !vasos.length) {
    return Object.assign(base, { faltantes: [], dudosos: [], resultado: 'FOTO_PEDIDO', mensaje_corto: MENSAJES.FOTO_PEDIDO });
  }

  // 1. ¿Están todos los vasos/baldes?
  const contar = function (tipos, lista, campoCantidad) {
    return lista.filter(function (x) { return tipos.indexOf(x.tipo) >= 0; })
      .reduce(function (s, x) { return s + (campoCantidad ? (Number(x.cantidad) || 1) : 1); }, 0);
  };
  const vasosPedidos = contar(['bowl', 'signature', 'smoothie'], productos, true);
  const vasosVistos = contar(['bowl', 'smoothie'], vasos, false);
  if (vasosVistos < vasosPedidos) faltantes.push((vasosPedidos - vasosVistos) + ' vaso(s): se pidieron ' + vasosPedidos + ' y se ven ' + vasosVistos);
  const baldesPedidos = contar(['balde'], productos, true);
  const baldesVistos = contar(['balde'], vasos, false);
  if (baldesVistos < baldesPedidos) faltantes.push((baldesPedidos - baldesVistos) + ' balde(s)');

  // 2. Toppings (se compara contra todo lo visto en las fotos)
  const vistos = [];
  vasos.forEach(function (vaso) {
    (vaso.toppings || []).forEach(function (t) { vistos.push({ n: norm(t.nombre), confianza: t.confianza }); });
  });
  let muchosToppings = false;
  const toppingsFaltantes = [];
  productos.forEach(function (p) {
    if (['bowl', 'signature', 'smoothie'].indexOf(p.tipo) < 0) return;
    const esperados = toppingsEsperados(p);
    if (p.tipo !== 'smoothie' && esperados.length > CONFIG.MAX_TOPPINGS_CONFIABLE) muchosToppings = true;
    const sufijo = productos.length > 1 ? ' — ' + p.nombre : '';
    esperados.forEach(function (t) {
      const r = evaluar(t.n, vistos, t.enCarta);
      // En smoothies los toppings van encima y a veces no se ven: nunca "falta", solo "revisar"
      if (r.estado === 'falta' && p.tipo !== 'smoothie') toppingsFaltantes.push(t.etiqueta + sufijo);
      else if (r.estado !== 'ok') dudosos.push(t.etiqueta + ' (' + (r.motivo || 'no se ve') + ')' + sufijo);
    });
  });

  // 3. Cuchara
  if (c.cuchara_pedida === true && v.cuchara_vista !== true) dudosos.push('Cuchara (pidió cuchara: confirmar que va en la bolsa)');

  // 4. Resultado. Si las capas están mezcladas o hay muchos toppings, la foto no es confiable:
  //    los toppings "faltantes" pasan a "revisar" y lo decide la persona.
  const revisionManual = v.capas_mezcladas === true || muchosToppings;
  if (revisionManual) toppingsFaltantes.forEach(function (t) { dudosos.push(t + ' (no se ve)'); });
  else toppingsFaltantes.forEach(function (t) { faltantes.push(t); });

  let resultado;
  if (faltantes.length) resultado = 'FALTA';
  else if (revisionManual) resultado = 'REVISION_MANUAL';
  else if (dudosos.length) resultado = 'REVISAR';
  else resultado = 'OK';

  return Object.assign(base, { faltantes: faltantes, dudosos: dudosos, resultado: resultado, mensaje_corto: MENSAJES[resultado] });
}

const MENSAJES = {
  OK: 'Pedido completo. Puedes cerrar la bolsa.',
  REVISAR: 'Revisa lo marcado antes de cerrar.',
  FALTA: 'Falta algo. Corrige y vuelve a tomar la foto del pedido.',
  REVISION_MANUAL: 'Muchos toppings o capas mezcladas: revísalo tú contra la comanda.',
  SIN_TICKET: 'No se lee la comanda. Vuelve a tomar esa foto, más de cerca.',
  FOTO_PEDIDO: 'No se ve bien el pedido. Vuelve a tomar la foto, de costado.',
};

// ==================== RESUMEN DIARIO PARA EL ADMINISTRADOR ====================
// Manda un correo con los pedidos del día que necesitan revisión y los links a sus fotos.
// Destinatario: la propiedad CORREO_RESUMEN (si existe) o la cuenta dueña del script.
function resumenDiario() {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.openById(props.getProperty('HOJA_ID'));
  const hoja = ss.getSheetByName('Registro');
  const hoy = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');
  const rango = hoja.getDataRange();
  const valores = rango.getValues();
  const vistos = rango.getDisplayValues();
  const fecha = function (v) { return v instanceof Date ? Utilities.formatDate(v, CONFIG.ZONA_HORARIA, 'yyyy-MM-dd') : String(v); };

  const filas = [];
  for (let i = 1; i < valores.length; i++) if (fecha(valores[i][0]) === hoy) filas.push(vistos[i]);
  if (!filas.length) return;

  const cuenta = {};
  filas.forEach(function (f) { cuenta[f[4]] = (cuenta[f[4]] || 0) + 1; });
  const IMPORTAN = ['FALTA', 'REVISION_MANUAL', 'SIN_TICKET', 'FOTO_PEDIDO', 'ERROR_IA'];
  const problemas = filas.filter(function (f) { return IMPORTAN.indexOf(f[4]) >= 0; });

  const esc = function (t) { return String(t || '').replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
  const links = function (f) {
    const ped = String(f[11] || '').split('\n').filter(String);
    return '<a href="' + f[10] + '">comanda</a>' + ped.map(function (u, i) { return ' · <a href="' + u + '">pedido ' + (i + 1) + '</a>'; }).join('');
  };
  const tabla = problemas.length
    ? '<table cellpadding="6" style="border-collapse:collapse;font-size:14px">' +
      '<tr style="background:#f1e8f5"><th align="left">Hora</th><th align="left">N° pedido</th><th align="left">Resultado</th><th align="left">Detalle</th><th align="left">Fotos</th></tr>' +
      problemas.map(function (f) {
        const partes = [];
        if (f[6]) partes.push('Falta: ' + esc(f[6]));
        if (f[7]) partes.push('Revisar: ' + esc(f[7]));
        const detalle = partes.length ? partes.join('<br>') : esc(f[9]);
        return '<tr style="border-top:1px solid #e4dae8"><td>' + esc(f[1]) + '</td><td>' + esc(f[3]) + '</td><td>' + esc(f[4]) +
          '</td><td>' + detalle + '</td><td>' + links(f) + '</td></tr>';
      }).join('') + '</table>'
    : '<p>Ningún pedido con faltantes hoy.</p>';

  const resumen = Object.keys(cuenta).sort().map(function (k) { return k + ': ' + cuenta[k]; }).join(' · ');
  const html = '<div style="font-family:Arial,sans-serif;color:#2a1035">' +
    '<h2 style="margin:0 0 4px">OakGPT · ' + esc(CONFIG.LOCAL) + '</h2>' +
    '<p style="margin:0 0 16px;color:#5c4f63">' + hoy + ' · ' + filas.length + ' pedidos · ' + esc(resumen) + '</p>' +
    '<h3 style="margin:16px 0 8px">Para revisar (' + problemas.length + ')</h3>' + tabla +
    '<p style="margin-top:20px;font-size:12px;color:#777">Los “Revisar” por tipo de granola, polvos o cuchara no se listan; están en la hoja.<br>' +
    '<a href="' + ss.getUrl() + '">Abrir la hoja completa</a></p></div>';

  const destino = props.getProperty('CORREO_RESUMEN') || Session.getEffectiveUser().getEmail();
  const faltas = cuenta.FALTA || 0;
  MailApp.sendEmail({
    to: destino,
    subject: 'OakGPT ' + CONFIG.LOCAL + ' · ' + hoy + ' · ' + (faltas ? faltas + ' con faltantes' : 'sin faltantes'),
    htmlBody: html,
  });
}

/** Ejecutar UNA vez: programa el correo todos los días entre las 10 y 11 p.m. (hora de Lima). */
function activarResumenDiario() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'resumenDiario') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('resumenDiario').timeBased().everyDays(1).atHour(22).inTimezone(CONFIG.ZONA_HORARIA).create();
  Logger.log('Listo: el resumen llegará todos los días entre 10 y 11 p.m. a ' +
    (PropertiesService.getScriptProperties().getProperty('CORREO_RESUMEN') || Session.getEffectiveUser().getEmail()));
}

// ==================== INSTALACIÓN (ejecutar una vez) ====================
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('HOJA_ID')) {
    Logger.log('Ya estaba instalado. Hoja: ' + SpreadsheetApp.openById(props.getProperty('HOJA_ID')).getUrl());
    return;
  }

  const principal = DriveApp.createFolder(CONFIG.CARPETA_PRINCIPAL);
  const fotos = principal.createFolder('Fotos ' + CONFIG.LOCAL);

  const ss = SpreadsheetApp.create('Fotocheck - Registro');
  DriveApp.getFileById(ss.getId()).moveTo(principal);
  const hoja = ss.getSheets()[0];
  hoja.setName('Registro');
  hoja.appendRow(['Fecha', 'Hora', 'Local', 'N° pedido', 'Resultado', 'Productos', 'Faltantes',
    'Dudosos', 'Cuchara pedida', 'Mensaje', 'Foto comanda', 'Fotos pedido', 'Detalle IA', 'Segundos', 'Modelo']);
  hoja.setFrozenRows(1);
  hoja.getRange('1:1').setFontWeight('bold');

  const reglas = [
    ['OK', '#d9ead3'], ['REVISAR', '#fff2cc'], ['REVISION_MANUAL', '#fff2cc'],
    ['FALTA', '#f4cccc'], ['SIN_TICKET', '#f4cccc'], ['FOTO_PEDIDO', '#f4cccc'], ['ERROR_IA', '#efefef'],
  ].map(function (r) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(r[0]).setBackground(r[1])
      .setRanges([hoja.getRange('E2:E')]).build();
  });
  hoja.setConditionalFormatRules(reglas);

  props.setProperty('HOJA_ID', ss.getId());
  props.setProperty('CARPETA_FOTOS_ID', fotos.getId());
  Logger.log('Listo. Carpeta: ' + principal.getUrl() + ' | Hoja: ' + ss.getUrl());
}

/**
 * Prueba cada modelo de la lista y usa el primero que responda.
 * Saturado (429/5xx) → reintenta una vez y pasa al siguiente. No existe (404) → pasa al siguiente.
 * Clave inválida (401/403) u otro error → se detiene, porque cambiar de modelo no lo arregla.
 */
function llamarConRespaldo(key, payload) {
  const opciones = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  let ultimoError = '';
  for (let m = 0; m < CONFIG.MODELOS.length; m++) {
    const modelo = CONFIG.MODELOS[m];
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelo + ':generateContent';
    for (let intento = 1; intento <= 2; intento++) {
      const resp = UrlFetchApp.fetch(url, opciones);
      const code = resp.getResponseCode();
      if (code === 200) return { resp: resp, modelo: modelo };
      ultimoError = modelo + ' respondió ' + code + ': ' + resp.getContentText().slice(0, 200);
      if (code === 400 && /thinking/i.test(resp.getContentText()) && opciones.payload.indexOf('thinkingConfig') >= 0) {
        opciones.payload = JSON.stringify(sinRazonamiento(payload)); intento--; continue;   // reintenta sin razonamiento
      }
      if (code === 404) break;                                  // modelo no existe → siguiente
      if (code === 429 || code >= 500) {                        // saturado
        if (intento < 2) { Utilities.sleep(3000); continue; }
        break;                                                  // → siguiente modelo
      }
      throw new Error(ultimoError);                             // clave mala u otro error
    }
  }
  throw new Error('Ningún modelo disponible. Último: ' + ultimoError);
}

/** Prueba rápida de la clave: ejecutar desde el editor. */
function probarConexion() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  try {
    const r = llamarConRespaldo(key, { contents: [{ parts: [{ text: 'Responde solo: OK' }] }] });
    Logger.log('200 ✓ Funciona con ' + r.modelo + ' → ' + r.resp.getContentText().slice(0, 150));
  } catch (e) {
    Logger.log('✗ ' + e.message);
  }
}
