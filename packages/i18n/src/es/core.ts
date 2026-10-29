/**
 * Spanish for: core (see index.ts). English text that `packages/core` services produce (error
 * messages, job stages, review notes, change descriptions, connection statuses), shown through
 * `t.text()`. Multi-sentence texts are split into sentences by `t.text`, so templates are listed
 * sentence by sentence.
 */
export const core: Record<string, string> = {
  // --- Linked sources and connections (connections/*) ---
  'This is larger than we can bring in at once (25 MB).':
    'Esto es más grande de lo que podemos traer de una vez (25 MB).',
  'We couldn’t reach this source.': 'No pudimos conectar con esta fuente.',
  'We couldn’t reach this source just now. We’ll try again later.':
    'No pudimos conectar con esta fuente en este momento. Lo volveremos a intentar más tarde.',
  'We couldn’t check this source just now. We’ll try again later.':
    'No pudimos revisar esta fuente en este momento. Lo volveremos a intentar más tarde.',
  'The daily check of linked sources didn’t finish. It will try again tomorrow.':
    'La revisión diaria de las fuentes vinculadas no terminó. Se volverá a intentar mañana.',
  'We’ll try again later.': 'Lo volveremos a intentar más tarde.',
  'Please try again.': 'Inténtalo de nuevo.',
  'Please connect it again.': 'Vuelve a conectarlo.',
  '{label} no longer lets us in.': '{label} ya no nos da acceso.',
  '{label} didn’t answer just now.': '{label} no respondió en este momento.',
  '{label} sent something we couldn’t read.': '{label} envió algo que no pudimos leer.',
  '{label} is busy just now.': '{label} no puede atendernos en este momento.',
  '{label} isn’t switched on here yet.': '{label} todavía no está activado aquí.',
  'That connection didn’t work. Please start again from My data.':
    'Esa conexión no funcionó. Empieza de nuevo desde Mis datos.',
  '{label} wasn’t connected.': '{label} no se conectó.',
  'You can try again any time.': 'Puedes volver a intentarlo cuando quieras.',
  '{label} didn’t answer.': '{label} no respondió.',
  'This {label} account isn’t connected any more.': 'Esta cuenta de {label} ya no está conectada.',
  'That QuickBooks company can’t be read.': 'No podemos leer esa empresa de QuickBooks.',
  'QuickBooks didn’t say which company to read. Please try again.':
    'QuickBooks no indicó qué empresa leer. Inténtalo de nuevo.',
  'Something went wrong while checking this source. We’ll try again later.':
    'Algo salió mal al revisar esta fuente. Lo volveremos a intentar más tarde.',
  'That doesn’t look like a Google Sheets link. Open the sheet, choose Share → Copy link, and paste it here.':
    'Eso no parece un enlace de Google Sheets. Abre la hoja, elige Compartir → Copiar enlace y pégalo aquí.',
  'This sheet is already linked. It updates by itself.':
    'Esta hoja ya está vinculada. Se actualiza sola.',
  'We couldn’t find that connection.': 'No encontramos esa conexión.',
  'The person who linked this can now only view this business. Please link it again.':
    'La persona que vinculó esto ahora solo puede ver este negocio. Vuelve a vincularlo.',
  'The person who linked this is no longer part of this business. Please link it again.':
    'La persona que vinculó esto ya no forma parte de este negocio. Vuelve a vincularlo.',
  'We couldn’t find that source.': 'No encontramos esa fuente.',
  'This source was disconnected. Please connect it again.':
    'Esta fuente se desconectó. Vuelve a conectarla.',
  'This sheet isn’t shared. In Google Sheets, choose Share → “Anyone with the link” → Viewer, then try again.':
    'Esta hoja no está compartida. En Google Sheets, elige Compartir → “Cualquier persona con el enlace” → Lector y vuelve a intentarlo.',
  'We couldn’t find this sheet. It may have been deleted, or the link is incomplete.':
    'No encontramos esta hoja. Puede que se haya eliminado o que el enlace esté incompleto.',
  'Google Sheets didn’t answer just now. We’ll try again later.':
    'Google Sheets no respondió en este momento. Lo volveremos a intentar más tarde.',
  'Shopify didn’t give us access. Please try connecting again.':
    'Shopify no nos dio acceso. Intenta conectarlo de nuevo.',
  'That isn’t a Shopify store address.': 'Esa no es una dirección de tienda de Shopify.',
  'Shopify no longer lets us in. Please connect your store again.':
    'Shopify ya no nos da acceso. Vuelve a conectar tu tienda.',
  'Shopify didn’t answer just now. We’ll try again later.':
    'Shopify no respondió en este momento. Lo volveremos a intentar más tarde.',
  'Please enter your store’s Shopify address, like your-store.myshopify.com.':
    'Escribe la dirección de Shopify de tu tienda, como tu-tienda.myshopify.com.',
  'Shopify didn’t answer. Please try again.': 'Shopify no respondió. Inténtalo de nuevo.',
  'BizRetriever was removed from this Shopify store. Your records stay.':
    'BizRetriever se quitó de esta tienda de Shopify. Tus registros se conservan.',
  'This store isn’t connected any more. Please connect it again.':
    'Esta tienda ya no está conectada. Vuelve a conectarla.',
  'This Shopify store is paused or locked, so we can’t read it.':
    'Esta tienda de Shopify está en pausa o bloqueada, así que no podemos leerla.',
  'Shopify didn’t let us read everything we need. Please connect your store again and allow access.':
    'Shopify no nos dejó leer todo lo que necesitamos. Vuelve a conectar tu tienda y permite el acceso.',
  'Shopify is busy just now. We’ll try again later.':
    'Shopify no puede atendernos en este momento. Lo volveremos a intentar más tarde.',
  'Square didn’t say which business to read. Please try again.':
    'Square no indicó qué negocio leer. Inténtalo de nuevo.',
  'WooCommerce isn’t switched on here yet.': 'WooCommerce todavía no está activado aquí.',
  'Your WooCommerce store': 'Tu tienda de WooCommerce',
  'Your WooCommerce store sent something we couldn’t read.':
    'Tu tienda de WooCommerce envió algo que no pudimos leer.',
  'That Xero organisation can’t be read.': 'No podemos leer esa organización de Xero.',
  'Xero didn’t give us an organisation to read. Please try again.':
    'Xero no nos dio ninguna organización para leer. Inténtalo de nuevo.',

  // --- Other currencies (currency/*) ---
  '{label}: no published exchange rate for {currency} on {day}, so it was left empty':
    '{label}: no hay tipo de cambio publicado para {currency} el {day}, así que se dejó vacío',
  '1 amount in {currency} converted to {business} at the European Central Bank’s rate for each record’s date.':
    '1 importe en {currency} convertido a {business} al tipo de cambio del Banco Central Europeo para la fecha de cada registro.',
  '{n} amounts in {currency} converted to {business} at the European Central Bank’s rate for each record’s date.':
    '{n} importes en {currency} convertidos a {business} al tipo de cambio del Banco Central Europeo para la fecha de cada registro.',
  '{list} converted to {business} at the European Central Bank’s rate for each record’s date.':
    '{list} convertidos a {business} al tipo de cambio del Banco Central Europeo para la fecha de cada registro.',
  '1 amount in {currency} left empty: there’s no published exchange rate for it (from {firstDay}).':
    '1 importe en {currency} quedó vacío: no hay tipo de cambio publicado para esa moneda (desde el {firstDay}).',
  '{n} amounts in {currency} left empty: there’s no published exchange rate for it (from {firstDay}).':
    '{n} importes en {currency} quedaron vacíos: no hay tipo de cambio publicado para esa moneda (desde el {firstDay}).',
  'Today’s exchange rates couldn’t be fetched. We’ll try again tomorrow.':
    'No pudimos obtener los tipos de cambio de hoy. Lo volveremos a intentar mañana.',

  // --- Dashboard (dashboard/*) ---
  Dashboard: 'Panel',
  'That tile isn’t on your dashboard any more.': 'Esa tarjeta ya no está en tu panel.',
  'Add “{title}”': 'Añadir “{title}”',
  'Remove “{title}”': 'Quitar “{title}”',
  'Rename “{title}” to “{name}”': 'Cambiar el nombre de “{title}” a “{name}”',
  'Show “{title}” as {chart}': 'Mostrar “{title}” como {chart}',
  'Change what “{title}” shows': 'Cambiar lo que muestra “{title}”',
  'Resize “{title}”': 'Cambiar el tamaño de “{title}”',
  'Keep the dates of “{title}”': 'Mantener las fechas de “{title}”',
  '“{title}” follows the dashboard dates': '“{title}” sigue las fechas del panel',
  'Move “{title}”': 'Mover “{title}”',
  'Move “{title}” to the top': 'Mover “{title}” al principio',
  'Move “{title}” to the bottom': 'Mover “{title}” al final',
  'Show “{title}” by day': 'Mostrar “{title}” por día',
  'Show “{title}” by week': 'Mostrar “{title}” por semana',
  'Show “{title}” by month': 'Mostrar “{title}” por mes',
  'Show “{title}” by quarter': 'Mostrar “{title}” por trimestre',
  'Show “{title}” by year': 'Mostrar “{title}” por año',
  'a number': 'un número',
  'a line chart': 'un gráfico de líneas',
  'a bar chart': 'un gráfico de barras',
  'a stacked bar chart': 'un gráfico de barras apiladas',
  'stacked bars': 'barras apiladas',
  'a table': 'un cuadro',
  'Which one do you want to remove?': '¿Cuál quieres quitar?',
  'Which one do you want to rename?': '¿A cuál quieres cambiarle el nombre?',
  'Which one do you want to move?': '¿Cuál quieres mover?',
  'Which one do you want to change?': '¿Cuál quieres cambiar?',
  'I couldn’t work out that change. Try something like “Add a chart of sales by city”, “Remove the top customers list” or “Show sales over time monthly”.':
    'No pude entender ese cambio. Prueba algo como “Añade un gráfico de ventas por ciudad”, “Quita la lista de mejores clientes” o “Muestra las ventas en el tiempo por mes”.',
  'Not in your data yet.': 'Todavía no está en tus datos.',
  'Built your dashboard': 'Creamos tu panel',
  'Added {list} for your new data': 'Añadimos {list} para tus datos nuevos',
  'There’s nothing to change.': 'No hay nada que cambiar.',
  'That change can’t be made to your dashboard.': 'Ese cambio no se puede hacer en tu panel.',
  'There’s nothing to undo.': 'No hay nada que deshacer.',
  'Undid: {summary}': 'Deshecho: {summary}',
  'Leaves out records with no {nouns}.': 'Deja fuera los registros sin {nouns}.',
  'Couldn’t load this.': 'No se pudo cargar.',
  'Last 7 days': 'Últimos 7 días',
  'Last 30 days': 'Últimos 30 días',
  'Last 90 days': 'Últimos 90 días',
  'This month': 'Este mes',
  'Last month': 'El mes pasado',
  'This quarter': 'Este trimestre',
  'This year': 'Este año',
  'Last year': 'El año pasado',
  'All time': 'Todo el tiempo',

  // --- Looking things up (executor, semantic/*) ---
  "We couldn't work that out from your data. Please try asking in a different way.":
    'No pudimos calcular eso con tus datos. Prueba a preguntarlo de otra forma.',
  'That took too long. Try a shorter date range, or ask about fewer things at once.':
    'Eso tardó demasiado. Prueba con un periodo más corto o pregunta por menos cosas a la vez.',
  "That isn't something we can look up.": 'Eso no es algo que podamos buscar.',
  'We had trouble reaching your data. Please try again in a moment.':
    'Tuvimos problemas para acceder a tus datos. Inténtalo de nuevo en un momento.',
  'Unknown measure “{id}”.': 'Medida desconocida: “{id}”.',
  'the {field} of your {plural}': 'el dato {field} de tus {plural}',
  'Add {list} to see {measure}.': 'Añade {list} para ver {measure}.',
  'Upload the files this needs to see {measure}.':
    'Sube los archivos necesarios para ver {measure}.',
  'We don’t have that detail in your data yet.': 'Ese dato todavía no está en tus datos.',
  'We can’t narrow {plural} down by {field}.': 'No podemos filtrar {plural} por {field}.',
  'We can’t work that out per {thing}.': 'No podemos calcular eso por {thing}.',
  'We can’t filter on that.': 'No podemos filtrar por eso.',
  'We can’t break that down.': 'No podemos desglosar eso.',
  'We can’t split {plural} by {field}.': 'No podemos separar {plural} por {field}.',
  '{plural} don’t have dates, so we can’t show them over time.':
    '{plural} no tienen fechas, así que no podemos mostrarlos en el tiempo.',
  'We can’t connect {from} to {to}.': 'No podemos relacionar {from} con {to}.',
  'Pick a date range to compare with.': 'Elige un periodo para comparar.',
  'We don’t have a measure called “{id}”.': 'No tenemos ninguna medida llamada “{id}”.',
  'We can’t filter by that.': 'No podemos filtrar por eso.',
  'We can’t sort by that.': 'No podemos ordenar por eso.',
  '{label} (before)': '{label} (antes)',
  Day: 'Día',
  Week: 'Semana',
  Month: 'Mes',
  Quarter: 'Trimestre',
  Year: 'Año',
  'I couldn’t work that out safely. Try asking in a different way.':
    'No pude calcular eso de forma segura. Prueba a preguntarlo de otra forma.',
  'There’s more than one way to connect those records, so we can’t be sure which you mean.':
    'Hay más de una forma de relacionar esos registros, así que no podemos saber con certeza a cuál te refieres.',
  'Some amounts were in {list}: they were converted to {currency} at the European Central Bank’s rate for each record’s date.':
    'Algunos importes estaban en {list}: se convirtieron a {currency} al tipo de cambio del Banco Central Europeo para la fecha de cada registro.',
  '{plural} are linked to {other}': '{plural} tienen vínculo con {other}',
  'Names need 1 to 60 characters.': 'Los nombres deben tener entre 1 y 60 caracteres.',
  'We couldn’t find that measure.': 'No encontramos esa medida.',
  'We couldn’t find that type of record.': 'No encontramos ese tipo de registro.',
  'We couldn’t find that detail.': 'No encontramos ese dato.',

  // --- Downloads (export/*) ---
  'Shows the first {n} rows.': 'Muestra las primeras {n} filas.',
  'Shows {shown} of {total} rows.': 'Muestra {shown} de {total} filas.',
  'The Excel download has more.': 'La descarga de Excel tiene más.',
  'How it was worked out': 'Cómo se calculó',
  'Good to know': 'Conviene saberlo',
  'Highest: {value}': 'Máximo: {value}',
  '{name}  ·  Page {page} of {count}  ·  BizRetriever':
    '{name}  ·  Página {page} de {count}  ·  BizRetriever',
  'About this file': 'Sobre este archivo',
  Question: 'Pregunta',
  Answer: 'Respuesta',
  'Compared with': 'Comparado con',
  Assumption: 'Supuesto',
  Note: 'Nota',
  Asked: 'Preguntado',
  Downloaded: 'Descargado',
  Tile: 'Tarjeta',
  Dates: 'Fechas',
  Made: 'Creado',
  Business: 'Negocio',
  'The first {shown} of {total} records.': 'Los primeros {shown} de {total} registros.',
  '1 record.': '1 registro.',

  // --- Bringing in files: what changed (ingestion/changes.ts) ---
  'one of your sheets': 'una de tus hojas',
  'We’ll skip {name}.': 'Omitiremos {name}.',
  'We’ll now bring in {name}.': 'Ahora traeremos {name}.',
  '{name} now gives {records}.': '{name} ahora aporta {records}.',
  'In {name}, “{header}” is now the {field}.': 'En {name}, “{header}” ahora se usa como {field}.',
  'In {name}, we now fill in the {field}.': 'En {name}, ahora completamos el dato {field}.',
  'In {name}, we changed how we read the {field}.':
    'En {name}, cambiamos cómo leemos el dato {field}.',
  'In {name}, we no longer fill in the {field}.': 'En {name}, ya no completamos el dato {field}.',
  '{name} no longer gives {records}.': '{name} ya no aporta {records}.',
  'We’ll keep some similar names apart.': 'Mantendremos separados algunos nombres parecidos.',
  'We’ll merge more similar names.': 'Uniremos más nombres parecidos.',

  // --- Bringing in files: what we found (ingestion/heuristic.ts, corrections, validate) ---
  'You asked us not to bring this in': 'Nos pediste que no trajéramos esto',
  'your answer': 'tu respuesta',
  'Found a sheet that looks like {format} ({sheet})':
    'Encontramos una hoja que parece {format} ({sheet})',
  '“{sheet}” has a separate amount for each month.':
    '“{sheet}” tiene un importe distinto para cada mes.',
  'We’ll record each amount on the first day of its month in {year}.':
    'Registraremos cada importe el primer día de su mes en {year}.',
  'Lines with a negative quantity in “{sheet}” look like refunds.':
    'Las líneas con cantidad negativa en “{sheet}” parecen reembolsos.',
  'We’ll record them as returns, not sales.':
    'Las registraremos como devoluciones, no como ventas.',
  'In this Shopify export, “Name” is the order number, not a person’s name.':
    'En esta exportación de Shopify, “Name” es el número de pedido, no el nombre de una persona.',
  'Headings like “{heading}” in “{sheet}” are product categories.':
    'Los encabezados como “{heading}” en “{sheet}” son categorías de productos.',
  'We’ll attach each product to the heading above it.':
    'Asignaremos cada producto al encabezado que tiene encima.',
  'The stock numbers in “{sheet}” are how many you have today.':
    'Las cifras de inventario de “{sheet}” son las unidades que tienes hoy.',
  'We couldn’t tell what this table holds yet.': 'Todavía no sabemos qué contiene esta hoja.',
  'Are {names} and “{last}” the same customer?': '¿{names} y “{last}” son el mismo cliente?',
  'Are {names} the same customer?': '¿{names} son el mismo cliente?',
  'Yes, same customer': 'Sí, el mismo cliente',
  'No, they’re different': 'No, son distintos',
  'We also found other customer names written in slightly different ways (like “{name}”) and will treat each group as one customer.':
    'También encontramos otros nombres de clientes escritos de forma un poco distinta (como “{name}”) y trataremos cada grupo como un solo cliente.',
  'The dates in {sheets} look day-first (like {example}).':
    'Las fechas de {sheets} parecen tener el día primero (como {example}).',
  'The dates in {sheets} look month-first (like {example}).':
    'Las fechas de {sheets} parecen tener el mes primero (como {example}).',
  'Is that right?': '¿Es correcto?',
  Yes: 'Sí',
  'Does “{header}” in “{sheet}” mean the cost of one item?':
    '¿“{header}” en “{sheet}” es el costo de un artículo?',
  'Yes, per item': 'Sí, por artículo',
  'No, it’s a total': 'No, es un total',
  'We couldn’t find the {fields} for {plural} in this sheet, so we’ll leave them out for now.':
    'No encontramos {fields} de {plural} en esta hoja, así que por ahora los dejaremos fuera.',
  'Nothing we could bring in': 'Nada que pudiéramos traer',
  'We linked “{written}” to {to}: it’s the only one with all those words.':
    'Vinculamos “{written}” con {to}: es el único que tiene todas esas palabras.',
  'has no {field}, so we left it out': 'no tiene {field}, así que lo dejamos fuera',
  'mentions {thing} “{ref}”, which we couldn’t find':
    'menciona {thing} “{ref}”, que no encontramos',
  'Our AI helper is switched off.': 'Nuestro asistente de IA está desactivado.',
  'We couldn’t make that change automatically. Try the “Change” buttons instead.':
    'No pudimos hacer ese cambio automáticamente. Prueba mejor con los botones “Cambiar”.',

  // --- Bringing in files: the review (ingestion/review.ts) ---
  'Totals and subtotals': 'Totales y subtotales',
  'Blank lines': 'Líneas vacías',
  Notes: 'Notas',
  'Lines you asked us to skip': 'Líneas que nos pediste omitir',
  Titles: 'Títulos',
  'Section headings': 'Encabezados de sección',
  'Repeated headings': 'Encabezados repetidos',
  'the heading above': 'el encabezado de arriba',
  'the sheet name': 'el nombre de la hoja',
  'the month heading': 'el encabezado del mes',
  'the amount under each month': 'el importe de cada mes',
  'always “{value}”': 'siempre “{value}”',
  'counted within each order': 'contado dentro de cada pedido',
  'worked out from other details': 'calculado a partir de otros datos',
  '“Column {n}”': '“Columna {n}”',
  'a sheet': 'una hoja',
  'We couldn’t read the {field} on {pct}% of lines in “{sheet}”.':
    'No pudimos leer el dato {field} en el {pct}% de las líneas de “{sheet}”.',
  '{pct}% of lines in “{sheet}” have no {field}, so we can’t bring them in as {plural}.':
    'El {pct}% de las líneas de “{sheet}” no tiene {field}, así que no podemos traerlas como {plural}.',
  '{pct}% of {plural} mention a {thing} we couldn’t find in your other files.':
    'El {pct}% de {plural} menciona un registro de {thing} que no encontramos en tus otros archivos.',

  // --- Bringing in files: progress and problems (ingestion/jobs, service, reupload) ---
  'Something went wrong while reading your files. Please try uploading them again.':
    'Algo salió mal al leer tus archivos. Intenta subirlos de nuevo.',
  'Reading your files': 'Leyendo tus archivos',
  'We couldn’t find any information in these files.':
    'No encontramos información en estos archivos.',
  'Working out what everything is': 'Averiguando qué es cada cosa',
  'This looks like a newer version of “{name}”.':
    'Esto parece una versión más reciente de “{name}”.',
  'Checking every line': 'Revisando cada línea',
  'Writing up what we found': 'Resumiendo lo que encontramos',
  'Ready for you to check': 'Listo para que lo revises',
  'We couldn’t apply that change. Please try again.':
    'No pudimos aplicar ese cambio. Inténtalo de nuevo.',
  'Reading your note': 'Leyendo tu nota',
  Updating: 'Actualizando',
  Updated: 'Actualizado',
  Done: 'Listo',
  'Something went wrong while setting up your data. Nothing was changed.':
    'Algo salió mal al preparar tus datos. No se cambió nada.',
  'Setting up your records': 'Preparando tus registros',
  'Bringing in your records': 'Importando tus registros',
  'Comparing with your records': 'Comparando con tus registros',
  'Working out what we can measure': 'Viendo qué podemos medir',
  'Writing your data quality report': 'Escribiendo tu informe de calidad de datos',
  'Something went wrong while updating your data. Nothing was changed.':
    'Algo salió mal al actualizar tus datos. No se cambió nada.',
  'Updating your records': 'Actualizando tus registros',
  'Only finished updates can be undone.': 'Solo se pueden deshacer las actualizaciones terminadas.',
  'This update was already undone.': 'Esta actualización ya se deshizo.',
  'Updated from a new file': 'Actualizado desde un archivo nuevo',
  'Please choose at least one file.': 'Elige al menos un archivo.',
  'Please upload at most {n} files at a time.': 'Sube como máximo {n} archivos a la vez.',
  'We can read Excel (.xlsx) and CSV files.': 'Podemos leer archivos de Excel (.xlsx) y CSV.',
  '“{fileName}” is a different kind of file.': '“{fileName}” es otro tipo de archivo.',
  '“{fileName}” is empty.': '“{fileName}” está vacío.',
  '“{fileName}” is larger than 25 MB.': '“{fileName}” pesa más de 25 MB.',
  'We couldn’t start working on your files. Please try again.':
    'No pudimos empezar a trabajar con tus archivos. Inténtalo de nuevo.',
  'We couldn’t find that import.': 'No encontramos esa importación.',
  'This import is busy. Please wait a moment and try again.':
    'Esta importación está ocupada. Espera un momento y vuelve a intentarlo.',
  'This page is out of date. Please reload it.':
    'Esta página está desactualizada. Vuelve a cargarla.',
  'That question has already been answered.': 'Esa pregunta ya tiene respuesta.',
  'That change isn’t possible here.': 'Ese cambio no es posible aquí.',
  'Please tell us what looks wrong.': 'Cuéntanos qué parece estar mal.',
  'There’s nothing to bring in from these files yet.':
    'Todavía no hay nada que traer de estos archivos.',
  'This update isn’t waiting for you any more.': 'Esta actualización ya no te está esperando.',
  'This import can’t be cancelled right now.': 'Esta importación no se puede cancelar ahora mismo.',
  'Something went wrong while working on this. Your data is safe. Please try again.':
    'Algo salió mal mientras trabajábamos en esto. Tus datos están a salvo. Inténtalo de nuevo.',

  // --- Planning (planning/*) ---
  'You can’t set a goal for that.': 'No puedes fijar un objetivo para eso.',
  'Your data doesn’t have what that goal needs yet.':
    'Tus datos todavía no tienen lo que necesita ese objetivo.',
  'Please enter the goal as a number, like 12000.':
    'Escribe el objetivo como un número, por ejemplo 12000.',
  'That isn’t something we can estimate for this business.':
    'Eso no es algo que podamos estimar para este negocio.',
  '{month} is usually {pct} busier than your last 4 weeks.':
    '{month} suele tener {pct} más movimiento que tus últimas 4 semanas.',
  '{month} is usually {pct} quieter than your last 4 weeks.':
    '{month} suele tener {pct} menos movimiento que tus últimas 4 semanas.',
  'Your last 4 weeks were {pct} up on the same weeks last year, and we expect that to carry on.':
    'Tus últimas 4 semanas subieron {pct} respecto a las mismas semanas del año pasado, y esperamos que siga así.',
  'Your last 4 weeks were {pct} down on the same weeks last year, and we expect that to carry on.':
    'Tus últimas 4 semanas bajaron {pct} respecto a las mismas semanas del año pasado, y esperamos que siga así.',
  'We don’t know your busy and quiet months yet ({days} days of sales so far), so this carries your last 4 weeks forward.':
    'Todavía no conocemos tus meses de más y menos movimiento ({days} días de ventas hasta ahora), así que esto prolonga tus últimas 4 semanas.',
  'With a year of sales it will allow for the season.':
    'Con un año de ventas tendrá en cuenta la temporada.',
  '{weekdays} are your busiest day ({pct} above an average day).':
    '{weekdays} son tu día de más movimiento ({pct} por encima de un día promedio).',
  '{month} {year} so far: {soFar} of {target} ({pct}).':
    '{month} de {year} hasta ahora: {soFar} de {target} ({pct}).',
  '{label} so far: {soFar} of {target} ({pct}).':
    '{label} hasta ahora: {soFar} de {target} ({pct}).',
  'Heading for about {total} by the end of the month (likely between {low} and {high}).':
    'Va camino de unos {total} a fin de mes (probablemente entre {low} y {high}).',
  'Goal reached. Well done.': 'Objetivo alcanzado. ¡Bien hecho!',
  'To reach it: about {perDay} a day for the last day.':
    'Para alcanzarlo: unos {perDay} en el último día.',
  'To reach it: about {perDay} a day for the last {days} days.':
    'Para alcanzarlo: unos {perDay} al día durante los últimos {days} días.',
  Reached: 'Alcanzado',
  Ahead: 'Por delante',
  'On track': 'En camino',
  Behind: 'Por detrás',
  'Too early to say': 'Aún es pronto para saberlo',
  January: 'Enero',
  February: 'Febrero',
  March: 'Marzo',
  April: 'Abril',
  May: 'Mayo',
  June: 'Junio',
  July: 'Julio',
  August: 'Agosto',
  September: 'Septiembre',
  October: 'Octubre',
  November: 'Noviembre',
  December: 'Diciembre',
  Mondays: 'Los lunes',
  Tuesdays: 'Los martes',
  Wednesdays: 'Los miércoles',
  Thursdays: 'Los jueves',
  Fridays: 'Los viernes',
  Saturdays: 'Los sábados',
  Sundays: 'Los domingos',

  // --- Connect other apps (platform/keys.ts, webhooks.ts, jobs.ts) ---
  'Only the owner can {action}.': 'Solo el propietario puede {action}.',
  'Only the owner can create API keys.': 'Solo el propietario puede crear claves de API.',
  'Only the owner can revoke API keys.': 'Solo el propietario puede revocar claves de API.',
  'Only the owner can add webhooks.': 'Solo el propietario puede añadir webhooks.',
  'Only the owner can see webhooks.': 'Solo el propietario puede ver los webhooks.',
  'Only the owner can change webhooks.': 'Solo el propietario puede cambiar los webhooks.',
  'Only the owner can test webhooks.': 'Solo el propietario puede probar los webhooks.',
  'Only the owner can invite people.': 'Solo el propietario puede invitar a personas.',
  'Only the owner can cancel invitations.': 'Solo el propietario puede cancelar invitaciones.',
  'Only the owner can remove people.': 'Solo el propietario puede quitar a personas.',
  'Only the owner can change what people can do.':
    'Solo el propietario puede cambiar lo que pueden hacer las personas.',
  'Give the key a name.': 'Ponle un nombre a la clave.',
  'Names need 60 characters or fewer.': 'Los nombres deben tener 60 caracteres o menos.',
  'The demo shop can’t be connected to other apps.':
    'La tienda de demo no se puede conectar con otras apps.',
  'A business can have {n} keys.': 'Un negocio puede tener {n} claves.',
  'Revoke one you no longer use.': 'Revoca una que ya no uses.',
  'That key isn’t there any more.': 'Esa clave ya no existe.',
  'Some webhooks weren’t sent. They’ll be tried again.':
    'Algunos webhooks no se enviaron. Se volverán a intentar.',
  'Something new is worth knowing (a new insight)':
    'Hay algo nuevo que conviene saber (un hallazgo nuevo)',
  'New data was brought in (an import finished)':
    'Se trajeron datos nuevos (terminó una importación)',
  'Leave the user name and password out of the address.':
    'No incluyas el usuario ni la contraseña en la dirección.',
  'That address is too long.': 'Esa dirección es demasiado larga.',
  'That address is on a private network. Use a public https address.':
    'Esa dirección está en una red privada. Usa una dirección https pública.',
  'That address is on a private network.': 'Esa dirección está en una red privada.',
  'Add the address to send to.': 'Añade la dirección a la que enviar.',
  'Pick at least one thing to be told about.':
    'Elige al menos una cosa de la que quieras enterarte.',
  'Webhooks aren’t switched on for this BizRetriever yet.':
    'Los webhooks todavía no están activados en este BizRetriever.',
  'A business can have {n} webhooks.': 'Un negocio puede tener {n} webhooks.',
  'That webhook isn’t there any more.': 'Ese webhook ya no existe.',
  'The address answered {status}.': 'La dirección respondió {status}.',
  'No answer within 10 seconds.': 'Sin respuesta en 10 segundos.',
  'That address couldn’t be found.': 'No se encontró esa dirección.',
  'Sending failed.': 'El envío falló.',
  'The webhook is turned off.': 'El webhook está desactivado.',

  // --- Records (records/*) ---
  'That was already undone.': 'Eso ya se deshizo.',
  'Some of these records were changed again since. Undo the later change first.':
    'Algunos de estos registros se volvieron a cambiar después. Deshaz primero el cambio posterior.',
  'We couldn’t find those records.': 'No encontramos esos registros.',
  'That filter isn’t available.': 'Ese filtro no está disponible.',
  'We couldn’t find that record.': 'No encontramos ese registro.',
  'That detail can’t be changed here.': 'Ese dato no se puede cambiar aquí.',
  'We couldn’t find that record. It may have been deleted.':
    'No encontramos ese registro. Puede que se haya eliminado.',
  'It may have been deleted.': 'Puede que se haya eliminado.',
  'That link isn’t available.': 'Ese vínculo no está disponible.',
  'Choose a {thing} from the list.': 'Elige un valor de la lista para {thing}.',
  'Changed {field} of {title}': 'Se cambió {field} de {title}',
  'Choose up to 500 records.': 'Elige hasta 500 registros.',
  'Undo updates from files from the import’s page.':
    'Deshaz las actualizaciones desde archivos en la página de la importación.',
  'Deleted {what}': 'Eliminado: {what}',
  'Restored {what}': 'Restaurado: {what}',
  '{label} can’t be set to that.': '{label} no puede tener ese valor.',
  '{label} can’t be blank.': '{label} no puede quedar en blanco.',
  '{label} is too long.': '{label}: el texto es demasiado largo.',
  '{label} must be one of: {values}.': '{label}: elige entre {values}.',
  '{label} must be a number.': '{label} debe ser un número.',
  '{label} must be a whole number.': '{label} debe ser un número entero.',
  '{label} can have at most {max} decimal places.':
    '{label} puede tener como máximo {max} decimales.',
  '{label} is too large.': '{label}: el número es demasiado grande.',
  '{label} must be a real date.': '{label} debe ser una fecha válida.',
  '{label} must be a real date and time.': '{label} debe ser una fecha y hora válidas.',
  '{label} must be yes or no.': '{label} debe ser sí o no.',
  'I can’t add that kind of record.': 'No puedo añadir ese tipo de registro.',
  '{plural} don’t have a “{detail}”.': '{plural} no tienen “{detail}”.',
  '{plural} can’t be linked that way.': '{plural} no se pueden vincular así.',
  'I couldn’t find that {thing}.': 'No pude encontrar ese registro de {thing}.',
  'Which {thing} should I change?': '¿Qué registro de {thing} debo cambiar?',
  'I can only change the details of one record at a time.':
    'Solo puedo cambiar los datos de un registro a la vez.',
  'What should I change?': '¿Qué debo cambiar?',
  '{plural} can’t be added to a {thing}.': 'No se pueden añadir {plural} a un registro de {thing}.',
  'There’s nothing to add.': 'No hay nada que añadir.',
  '{label}: I used today.': '{label}: usé la fecha de hoy.',
  'Price for {title}: its selling price, {money}.':
    'Precio de {title}: su precio de venta, {money}.',
  'A {thing} needs “{label}”.': 'Un registro de {thing} necesita “{label}”.',
  'Add it': 'Añadirlo',
  'Save the change': 'Guardar el cambio',
  'That record was deleted in the meantime.': 'Ese registro se eliminó mientras tanto.',
  blank: 'vacío',
  item: 'artículo',
  'Today ({date})': 'Hoy ({date})',
  'New {thing} “{name}”': 'Nuevo registro de {thing}: “{name}”',
  '{qty} × {item} at {price}': '{qty} × {item} a {price}',

  // --- Reports (reports/*) ---
  'Every Monday': 'Cada lunes',
  'Every Tuesday': 'Cada martes',
  'Every Wednesday': 'Cada miércoles',
  'Every Thursday': 'Cada jueves',
  'Every Friday': 'Cada viernes',
  'Every Saturday': 'Cada sábado',
  'Every Sunday': 'Cada domingo',
  'On the {n}st of each month': 'El día {n} de cada mes',
  'On the {n}nd of each month': 'El día {n} de cada mes',
  'On the {n}rd of each month': 'El día {n} de cada mes',
  'On the {n}th of each month': 'El día {n} de cada mes',
  'Please choose how often to send it.': 'Elige cada cuánto enviarlo.',
  'Please choose a day of the week.': 'Elige un día de la semana.',
  'You can have up to {n} reports.': 'Puedes tener hasta {n} informes.',
  'Delete one first.': 'Elimina uno primero.',
  'Only answers with numbers can be sent as a report.':
    'Solo las respuestas con números se pueden enviar como informe.',
  'That report isn’t there any more.': 'Ese informe ya no existe.',
  'The question this report was made from can’t be answered any more.':
    'Ya no se puede responder la pregunta con la que se creó este informe.',
  'The email couldn’t be sent. We’ll try again tomorrow.':
    'No se pudo enviar el correo. Lo volveremos a intentar mañana.',
  'We couldn’t make this report. We’ll try again tomorrow.':
    'No pudimos crear este informe. Lo volveremos a intentar mañana.',
  'Today’s scheduled reports didn’t all go. They’ll be tried again tomorrow.':
    'No se enviaron todos los informes programados de hoy. Se volverán a intentar mañana.',

  // --- Changing what you track (structure/*, change-plan/*) ---
  text: 'texto',
  'a whole number': 'un número entero',
  'an amount of money': 'un importe de dinero',
  'a percentage': 'un porcentaje',
  'a date': 'una fecha',
  'a date and time': 'una fecha y hora',
  'yes or no': 'sí o no',
  'a link': 'un vínculo',
  records: 'registros',
  'Start keeping track of {plural}': 'Empezar a registrar {plural}',
  'Link {plural} to {other} (“{label}”)': 'Vincular {plural} con {other} (“{label}”)',
  'Add “{label}” to {plural}, as {kind}': 'Añadir “{label}” a {plural}, como {kind}',
  'Remove “{field}” from {plural}': 'Quitar “{field}” de {plural}',
  'Stop keeping track of {plural}, and remove them': 'Dejar de registrar {plural} y eliminarlos',
  'Make finding {plural} by {fields} faster': 'Hacer más rápido buscar {plural} por {fields}',
  'Call {plural} “{label}”': 'Llamar “{label}” a {plural}',
  'Rename “{field}” on {plural} to “{label}”':
    'Cambiar el nombre de “{field}” de {plural} a “{label}”',
  'Make “{field}” on {plural} {kind}': 'Convertir “{field}” de {plural} en {kind}',
  'Allow {values} for “{field}” on {plural}': 'Permitir {values} en “{field}” de {plural}',
  'Stop offering {values} for “{field}” on {plural}':
    'Dejar de ofrecer {values} en “{field}” de {plural}',
  'Unlink {plural} from {other} (their names are kept as text)':
    'Desvincular {plural} de {other} (sus nombres se conservan como texto)',
  'Clearing old backups didn’t finish. It will try again tomorrow.':
    'La limpieza de copias antiguas no terminó. Se volverá a intentar mañana.',
  'Which “{name}” do you mean: on {first} or on {second}?':
    '¿A qué “{name}” te refieres: el de {first} o el de {second}?',
  'Which “{name}” do you mean: {options}?': '¿A qué “{name}” te refieres: {options}?',
  '“{label}” is already {kind}.': '“{label}” ya es {kind}.',
  '“{label}” is used to tell {plural} apart, so it can’t be removed.':
    '“{label}” se usa para distinguir {plural}, así que no se puede quitar.',
  '“{label}” dates your {plural}, so it can’t be removed.':
    '“{label}” pone la fecha a tus {plural}, así que no se puede quitar.',
  '{plural} already have “{label}”.': '{plural} ya tienen “{label}”.',
  'You already track {plural}.': 'Ya registras {plural}.',
  'I couldn’t work out that change. Try “Track which salesperson made each sale”, “Rename selling price to RRP” or “Remove brand from products”.':
    'No pude entender ese cambio. Prueba con “Registra qué vendedor hizo cada venta”, “Cambia el nombre de precio de venta a PVP” o “Quita la marca de los productos”.',
  'This change removes data and needs explicit confirmation':
    'Este cambio elimina datos y necesita una confirmación explícita',
  'That change isn’t possible.': 'Ese cambio no es posible.',
  'That change isn’t possible: {problems}.': 'Ese cambio no es posible: {problems}.',
  'This removes “{label}” from {things}.': 'Esto quita “{label}” de {things}.',
  'We keep a copy for {days} days so you can undo.':
    'Guardamos una copia durante {days} días para que puedas deshacerlo.',
  'No {plural} have a “{label}” yet.': 'Todavía no hay {plural} con “{label}”.',
  'This removes all {things}.': 'Esto elimina en total {things}.',
  '{things} have a “{label}” that will be rounded.':
    '{things} tienen un valor de “{label}” que se redondeará.',
  '{things} have a “{label}” that can’t be read this way and will become blank.':
    '{things} tienen un valor de “{label}” que no se puede leer así y quedará en blanco.',
  'Every “{label}” can be read this way; nothing is lost.':
    'Todos los valores de “{label}” se pueden leer así; no se pierde nada.',
  'Nothing is lost.': 'No se pierde nada.',
  '{things} lose the link; the name stays as text.':
    '{things} pierden el vínculo; el nombre se conserva como texto.',
  '{things} keep their value; it just can’t be chosen any more.':
    '{things} conservan su valor; solo que ya no se podrá elegir.',
  'Existing {plural} will have it blank.':
    'Los registros de {plural} que ya existen lo tendrán en blanco.',
  'You can fill it in from a file or by hand.': 'Puedes completarlo desde un archivo o a mano.',
  '{measures} would stop working.': 'Dejaría de funcionar: {measures}.',
  'Dashboard charts affected: {tiles}.': 'Gráficos del panel afectados: {tiles}.',
  'No measures or dashboard charts change.':
    'No cambia ninguna medida ni ningún gráfico del panel.',
  'Affects {list}.': 'Afecta a {list}.',
  'To confirm, type “{text}”.': 'Para confirmar, escribe “{text}”.',
  'That change isn’t possible any more. Please try again.':
    'Ese cambio ya no es posible. Inténtalo de nuevo.',
  'Undid change {version}': 'Se deshizo el cambio {version}',
  'We couldn’t find that change.': 'No encontramos ese cambio.',
  'Only the latest change can be undone. Undo the later ones first.':
    'Solo se puede deshacer el cambio más reciente. Deshaz primero los posteriores.',
  'This change can’t be undone here.': 'Este cambio no se puede deshacer aquí.',
  'This change can’t be undone: {problems}.': 'Este cambio no se puede deshacer: {problems}.',
  "the copy kept for undoing this change is gone (it is kept for 30 days), so it can't be undone":
    'la copia guardada para deshacer este cambio ya no existe (se guarda durante 30 días), así que no se puede deshacer',
  'All {plural} come back as they were when the change was made.':
    'Todos los registros de {plural} vuelven a como estaban cuando se hizo el cambio.',
  '{n} {plural} added since the change won’t get the restored details back; they stay blank.':
    '{n} registros de {plural} añadidos desde el cambio no recuperarán los datos restaurados; quedarán en blanco.',
  '{n} {plural} have a “{label}” filled in since; undoing removes it.':
    '{n} registros de {plural} tienen “{label}” completado desde entonces; al deshacer se quita.',
  'Undoing removes all {n} {plural} added since.':
    'Al deshacer se eliminan los {n} registros de {plural} añadidos desde entonces.',
  'Some “{label}” values entered since may be rounded or become blank.':
    'Algunos valores de “{label}” introducidos desde entonces pueden redondearse o quedar en blanco.',
  'Undoing this would lose data entered since. Please confirm.':
    'Deshacer esto haría perder datos introducidos desde entonces. Confírmalo.',

  // --- Team (team/*) ---
  'That person can’t be given things to do here.':
    'A esa persona no se le pueden asignar tareas aquí.',
  'That insight isn’t open any more.': 'Ese hallazgo ya no está abierto.',
  'That isn’t waiting on anyone.': 'Eso no está esperando a nadie.',
  'Marked done.': 'Marcado como hecho.',
  'Write something first.': 'Escribe algo primero.',
  'Notes can be up to {n} characters.': 'Las notas pueden tener hasta {n} caracteres.',
  'That isn’t here any more.': 'Eso ya no está aquí.',
  'This has as many notes as it can take.': 'Esto ya tiene el máximo de notas.',
  'That note was already deleted.': 'Esa nota ya se eliminó.',
  'Only the person who wrote a note, or the owner, can delete it.':
    'Solo quien escribió la nota, o el propietario, puede eliminarla.',
  'Something that isn’t there any more': 'Algo que ya no existe',
  'The owner': 'El propietario',
  'Someone who left': 'Alguien que ya no está',
  'Only the owner can hand the business over.': 'Solo el propietario puede traspasar el negocio.',
  'The demo shop can’t be handed over.': 'La tienda de demo no se puede traspasar.',
  'Type the business’s name exactly to confirm.':
    'Escribe el nombre exacto del negocio para confirmar.',
  'You’re already the owner.': 'Ya eres el propietario.',
  'That person isn’t part of this business.': 'Esa persona no forma parte de este negocio.',
  'Only the owner can cancel a handover.': 'Solo el propietario puede cancelar un traspaso.',
  'There’s no handover waiting.': 'No hay ningún traspaso pendiente.',
  'That handover isn’t waiting for you any more.': 'Ese traspaso ya no está pendiente para ti.',
  'The person who asked isn’t the owner any more.':
    'La persona que lo pidió ya no es la propietaria.',
  'You aren’t part of this business any more.': 'Ya no formas parte de este negocio.',

  // --- People and the business (workspaces/*) ---
  'Please choose what they can do.': 'Elige qué puede hacer.',
  'Please enter a valid email address.': 'Escribe una dirección de correo válida.',
  '{email} is already in this business.': '{email} ya está en este negocio.',
  'That invitation was already used or cancelled.': 'Esa invitación ya se usó o se canceló.',
  'You can’t remove yourself.': 'No puedes quitarte a ti mismo.',
  'You can’t change your own role.': 'No puedes cambiar tu propio rol.',
  'This invitation link isn’t valid.': 'Este enlace de invitación no es válido.',
  'This invitation has already been used.': 'Esta invitación ya se usó.',
  'This invitation was cancelled. Ask for a new one.':
    'Esta invitación se canceló. Pide una nueva.',
  'This invitation has expired. Ask for a new one.': 'Esta invitación caducó. Pide una nueva.',
  'This invitation is for {email}.': 'Esta invitación es para {email}.',
  'Sign in with that email to accept it.': 'Inicia sesión con ese correo para aceptarla.',
  'Your records are kept in this currency, so it can’t change now.':
    'Tus registros se guardan en esta moneda, así que ya no se puede cambiar.',
  'You can view this business but not change it. Ask the owner.':
    'Puedes ver este negocio, pero no cambiarlo. Pídeselo al propietario.',
  'Only the owner can delete a business': 'Solo el propietario puede eliminar un negocio',
  'US dollar ($)': 'Dólar estadounidense ($)',
  'British pound (£)': 'Libra esterlina (£)',
  'Euro (€)': 'Euro (€)',
  'Canadian dollar (CA$)': 'Dólar canadiense (CA$)',
  'Australian dollar (A$)': 'Dólar australiano (A$)',
  'New Zealand dollar (NZ$)': 'Dólar neozelandés (NZ$)',
  'Indian rupee (₹)': 'Rupia india (₹)',
  'Pakistani rupee (Rs)': 'Rupia pakistaní (Rs)',
  'UAE dirham (AED)': 'Dírham de los EAU (AED)',
  'Saudi riyal (SAR)': 'Riyal saudí (SAR)',
  'Singapore dollar (S$)': 'Dólar de Singapur (S$)',
  'South African rand (R)': 'Rand sudafricano (R)',
  'Nigerian naira (₦)': 'Naira nigeriana (₦)',
  'Kenyan shilling (KSh)': 'Chelín keniano (KSh)',
  'Philippine peso (₱)': 'Peso filipino (₱)',
  'Malaysian ringgit (RM)': 'Ringgit malayo (RM)',
  'Bangladeshi taka (৳)': 'Taka bangladesí (৳)',
  'Mexican peso (MX$)': 'Peso mexicano (MX$)',
  'Brazilian real (R$)': 'Real brasileño (R$)',
  'Japanese yen (¥)': 'Yen japonés (¥)',
  'Choose a currency': 'Elige una moneda',
  'Choose a time zone': 'Elige una zona horaria',
  'Tell us how you write dates': 'Dinos cómo escribes las fechas',
  'Your business name needs at least 2 characters':
    'El nombre de tu negocio necesita al menos 2 caracteres',
  'Please keep your business name under 80 characters':
    'El nombre de tu negocio debe tener menos de 80 caracteres',
  'Choose what you sell': 'Elige qué vendes',
};
