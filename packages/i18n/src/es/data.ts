/** Spanish for: data (see index.ts). My data, bringing in files, the review, updates and linked sources. */
export const data: Record<string, string> = {
  // Errors from the upload, connect and data routes and actions
  'Not found': 'No encontrado',
  'You can view this business but not change it. Ask the owner.':
    'Puedes ver este negocio, pero no cambiarlo. Pídeselo al propietario.',
  'These files are too large to upload at once.':
    'Estos archivos son demasiado grandes para subirlos todos juntos.',
  'We couldn’t receive those files. Please try again.':
    'No pudimos recibir esos archivos. Inténtalo de nuevo.',
  'Something went wrong while uploading. Your files weren’t changed. Please try again.':
    'Algo salió mal al subir los archivos. Tus archivos no se modificaron. Inténtalo de nuevo.',
  'Please write what you’d like to add or change.': 'Escribe lo que quieres añadir o cambiar.',
  'This card is out of date. Please ask again.':
    'Esta tarjeta está desactualizada. Vuelve a pedirlo.',
  'There’s nothing to undo.': 'No hay nada que deshacer.',
  'That change isn’t possible here.': 'Ese cambio no es posible aquí.',
  'This page is out of date. Please reload it.':
    'Esta página está desactualizada. Vuelve a cargarla.',
  'This page is out of date.': 'Esta página está desactualizada.',
  'We couldn’t find that import.': 'No encontramos esa importación.',
  'Please try again.': 'Inténtalo de nuevo.',

  // Bring in your files
  'Bringing in files': 'Importación de archivos',
  'The owner or a member needs to check these files before they come in.':
    'El propietario o alguien que puede editar tiene que revisar estos archivos antes de que entren.',
  'Bring in your files': 'Trae tus archivos',
  'Bringing in files is for the owner and members.':
    'Solo el propietario y quienes pueden editar pueden traer archivos.',
  'Upload the spreadsheets you already have. We’ll work out what’s in them and check anything we’re unsure about with you. Newer versions of files you brought in before are recognised, and you’ll see what changes before anything is updated.':
    'Sube las hojas de cálculo que ya tienes. Averiguaremos qué contienen y te consultaremos lo que no tengamos claro. Reconocemos las versiones nuevas de archivos que ya trajiste, y verás qué cambia antes de que se actualice nada.',
  'Helpful files to include': 'Archivos útiles para incluir',
  'We can’t open PDF files yet. Export to Excel or CSV.':
    'Aún no podemos abrir archivos PDF. Expórtalo a Excel o CSV.',
  'Please save this as Excel (.xlsx) or CSV first.': 'Primero guárdalo como Excel (.xlsx) o CSV.',
  'We can read Excel (.xlsx) and CSV files.': 'Podemos leer archivos de Excel (.xlsx) y CSV.',
  'This file looks empty.': 'Este archivo parece vacío.',
  'This file is bigger than 25 MB. Try splitting it by year.':
    'Este archivo pesa más de 25 MB. Prueba a dividirlo por año.',
  'Something went wrong while uploading. Please try again.':
    'Algo salió mal al subir los archivos. Inténtalo de nuevo.',
  'We couldn’t reach BizRetriever. Check your connection and try again.':
    'No pudimos conectar con BizRetriever. Revisa tu conexión e inténtalo de nuevo.',
  'Drop your spreadsheets here: sales, stock lists, supplier orders, expenses. Excel or CSV. Messy is fine.':
    'Suelta aquí tus hojas de cálculo: ventas, listas de inventario, pedidos a proveedores, gastos. Excel o CSV. No importa si están desordenadas.',
  'Choose files': 'Elegir archivos',
  'Chosen files': 'Archivos elegidos',
  'Remove {name}': 'Quitar {name}',
  'Uploading… {progress}%': 'Subiendo… {progress}%',
  'Uploaded. Getting started…': 'Subido. Empezando…',
  'Make sense of my data': 'Entender mis datos',

  // Google Sheets, Shopify and other connections
  'Or link a Google Sheet': 'O vincula una hoja de Google Sheets',
  'Keep working in your sheet. We check it every day and bring in what changed. In Google Sheets, choose Share → “Anyone with the link” → Viewer, then copy the link.':
    'Sigue trabajando en tu hoja. La revisamos cada día y traemos lo que cambió. En Google Sheets, elige Compartir → “Cualquier persona con el enlace” → Lector y copia el enlace.',
  'Google Sheets link': 'Enlace de Google Sheets',
  'Reading your sheet…': 'Leyendo tu hoja…',
  'Link this sheet': 'Vincular esta hoja',
  'Or connect your Shopify store': 'O conecta tu tienda de Shopify',
  'We read your products, stock, customers and orders, and check for changes every day. We never change anything in your store.':
    'Leemos tus productos, inventario, clientes y pedidos, y buscamos cambios cada día. Nunca cambiamos nada en tu tienda.',
  'Your Shopify store address': 'La dirección de tu tienda de Shopify',
  'your-store.myshopify.com': 'tu-tienda.myshopify.com',
  'Connect Shopify': 'Conectar Shopify',
  'Please enter your store’s Shopify address, like your-store.myshopify.com. You’ll find it in Shopify under Settings → Domains.':
    'Escribe la dirección de Shopify de tu tienda, como tu-tienda.myshopify.com. La encontrarás en Shopify, en Configuración → Dominios.',
  'Or connect the tools you use': 'O conecta las herramientas que usas',
  'We read your sales, customers, products and payments, and check for changes every day. We never change anything there.':
    'Leemos tus ventas, clientes, productos y pagos, y buscamos cambios cada día. Nunca cambiamos nada allí.',
  'Connect {source}': 'Conectar {source}',
  'Your WooCommerce store’s web address': 'La dirección web de tu tienda de WooCommerce',
  'https://your-store.com': 'https://tu-tienda.com',
  'Connect WooCommerce': 'Conectar WooCommerce',
  'Please enter your store’s web address, like https://your-store.com. It has to start with https.':
    'Escribe la dirección web de tu tienda, como https://tu-tienda.com. Tiene que empezar por https.',

  // My data
  'Working on it': 'Trabajando en ello',
  'Waiting for you to check': 'Esperando tu revisión',
  Updating: 'Actualizando',
  'Setting up': 'Preparando',
  'Waiting for you to check the changes': 'Esperando que revises los cambios',
  'Updating your data': 'Actualizando tus datos',
  'Brought in': 'Importado',
  'Didn’t finish': 'No terminó',
  Stopped: 'Detenido',
  'Your Shopify store': 'Tu tienda de Shopify',
  'Your WooCommerce store': 'Tu tienda de WooCommerce',
  'Download all my data': 'Descargar todos mis datos',
  'Add or update files': 'Añadir o actualizar archivos',
  '{source} is connected. We’re reading it now; in a minute you’ll be able to check what we found, the same way as for a file.':
    '{source}: conexión lista. Ya estamos leyendo sus datos; en un minuto podrás revisar lo que encontramos, igual que con un archivo.',
  'Your records': 'Tus registros',
  'Your products, sales, customers and more will be here once you bring in your files.':
    'Tus productos, ventas, clientes y más aparecerán aquí cuando traigas tus archivos.',
  'Your imports': 'Tus importaciones',
  Undone: 'Deshecho',
  'Updated your data': 'Datos actualizados',

  // Linked sources on My data
  'Google Sheet': 'Hoja de Google',
  'Shopify store': 'Tienda de Shopify',
  'WooCommerce store': 'Tienda de WooCommerce',
  Open: 'Abrir',
  '{name} (opens in a new tab)': '{name} (se abre en una pestaña nueva)',
  'Has changes for you to check.': 'Tiene cambios para que los revises.',
  'Check the changes': 'Revisar los cambios',
  'Paused. We won’t check it until you resume.':
    'En pausa. No la revisaremos hasta que la reanudes.',
  'Checked {when}.': 'Última revisión: {when}.',
  'Not checked yet.': 'Aún no se ha revisado.',
  'Last change brought in {when}.': 'Último cambio importado: {when}.',
  'Changes will come in by themselves when nothing needs you.':
    'Los cambios entrarán solos cuando no haga falta que revises nada.',
  'We’ll ask you before bringing in changes.': 'Te preguntaremos antes de traer cambios.',
  'Bring in changes by itself when nothing needs me':
    'Traer los cambios automáticamente cuando no haga falta que revise nada',
  'Checking now. This takes a minute.': 'Revisando ahora. Tarda un minuto.',
  'Update now': 'Actualizar ahora',
  'Resumed.': 'Se reanudó.',
  'Paused.': 'En pausa.',
  Resume: 'Reanudar',
  Pause: 'Pausar',
  'Stop updating from this? Your records stay.':
    '¿Dejar de actualizar desde aquí? Tus registros se quedan.',
  'Stopped.': 'Se detuvo.',
  'Stop updating': 'Dejar de actualizar',
  'Keep it': 'Conservarlo',
  'Stop updating from this': 'Dejar de actualizar desde aquí',
  'Kept up to date from': 'Se mantiene al día desde',

  // Add or change by chat
  'Add or change something': 'Añade o cambia algo',
  'e.g. “Add a sale: 5 Sage mugs to Bloom & Co today” or “Track which salesperson made each sale”':
    'p. ej., “Añade una venta: 5 tazas Sage a Bloom & Co hoy” o “Registra qué vendedor hizo cada venta”',
  'What would you like to add or change?': '¿Qué quieres añadir o cambiar?',
  Go: 'Enviar',
  'Added {what}.': 'Añadido: {what}.',
  becomes: 'pasa a ser',
  new: 'nuevo',
  Total: 'Total',
  '{what} will be added too.': 'También se añadirá: {what}.',
  'What I assumed': 'Lo que supuse',
  'Done. It’s in your change history.': 'Listo. Está en tu historial de cambios.',
  History: 'Historial',
  'Undoing this would lose data entered since. Use Change history to see what and undo.':
    'Deshacer esto borraría datos que se añadieron después. Usa Historial de cambios para ver cuáles y deshacerlo.',
  'What will change': 'Qué va a cambiar',
  'This removes data. We keep a backup for 30 days so you can undo.':
    'Esto elimina datos. Guardamos una copia durante 30 días para que puedas deshacerlo.',
  'Type {text} to confirm': 'Escribe {text} para confirmar',
  'Make this change': 'Hacer este cambio',

  // Processing
  'We couldn’t finish this import': 'No pudimos terminar esta importación',
  'Your files are safe and nothing in your data was changed.':
    'Tus archivos están a salvo y no se cambió nada en tus datos.',
  'Something went wrong while reading your files.': 'Algo salió mal al leer tus archivos.',
  'Try again with different files': 'Intentarlo con otros archivos',
  'You stopped this import': 'Detuviste esta importación',
  'Nothing from these files was brought in.': 'No se importó nada de estos archivos.',
  'Upload files': 'Subir archivos',
  'Opening your files': 'Abriendo tus archivos',
  'Finding the real data (skipping titles, totals and blank lines)':
    'Buscando los datos reales (sin títulos, totales ni líneas en blanco)',
  'Working out what each detail means': 'Averiguando qué significa cada dato',
  'Checking how everything links together': 'Comprobando cómo se relaciona todo',
  'Doing a test run': 'Haciendo una prueba',
  'Creating your records': 'Creando tus registros',
  'Bringing in your records': 'Importando tus registros',
  'Writing your data report': 'Escribiendo el informe de tus datos',
  'Reading the new files': 'Leyendo los archivos nuevos',
  'Comparing them with your data': 'Comparándolos con tus datos',
  'Updating your records': 'Actualizando tus registros',
  'Refreshing your numbers': 'Actualizando tus cifras',
  'Setting things up': 'Preparándolo todo',
  'Comparing with your data': 'Comparando con tus datos',
  'Looking through your file. This usually takes under a minute. You can close this page; we’ll keep going.':
    'Revisando tu archivo. Suele tardar menos de un minuto. Puedes cerrar esta página; nosotros seguimos.',
  'Looking through your {n} files. This usually takes under a minute. You can close this page; we’ll keep going.':
    'Revisando tus {n} archivos. Suele tardar menos de un minuto. Puedes cerrar esta página; nosotros seguimos.',
  'Working out what’s new and what changed. Nothing is changed yet.':
    'Averiguando qué es nuevo y qué cambió. Todavía no se cambia nada.',
  'This takes a few moments.': 'Esto tarda unos momentos.',
  'In progress': 'En curso',
  'What we’ve spotted so far': 'Lo que hemos visto hasta ahora',

  // The data report
  'Your data is ready': 'Tus datos están listos',
  'Here’s what we brought in, and anything worth knowing.':
    'Esto es lo que importamos, y lo que conviene saber.',
  '{records} brought in.': 'Ya están en tus datos: {records}.',
  '{n} line skipped ({details}).': '{n} línea omitida ({details}).',
  '{n} lines skipped ({details}).': '{n} líneas omitidas ({details}).',
  'We kept these records and marked what’s missing.':
    'Conservamos estos registros y marcamos lo que falta.',
  'Things we assumed ({n})': 'Lo que supusimos ({n})',
  'See my dashboard': 'Ver mi panel',
  'Go to my data': 'Ir a mis datos',

  // After an update
  '{n} new {record}': '{n} {record} se añadió',
  '{n} new {records}': '{n} {records} se añadieron',
  '{n} {record} updated': '{n} {record} se actualizó',
  '{n} {records} updated': '{n} {records} se actualizaron',
  'This update was undone': 'Esta actualización se deshizo',
  'Your data is up to date': 'Tus datos están al día',
  'Your records are back to how they were before these files.':
    'Tus registros volvieron a como estaban antes de estos archivos.',
  'Your dashboard and answers now include the new files.':
    'Tu panel y tus respuestas ya incluyen los archivos nuevos.',
  'Nothing needed changing.': 'No hizo falta cambiar nada.',
  '{n} record wasn’t in the new files. We kept it.':
    '{n} registro no estaba en los archivos nuevos. Lo conservamos.',
  '{n} records weren’t in the new files. We kept them.':
    '{n} registros no estaban en los archivos nuevos. Los conservamos.',
  'Undo this update': 'Deshacer esta actualización',

  // Checking an update (merge review)
  'Nothing new in these files': 'No hay nada nuevo en estos archivos',
  'Here’s what would change': 'Esto es lo que cambiaría',
  'Everything in these files is already in your data.':
    'Todo lo de estos archivos ya está en tus datos.',
  'Nothing is changed until you choose “Update my data”. You can undo the update afterwards.':
    'No se cambia nada hasta que elijas “Actualizar mis datos”. Después puedes deshacer la actualización.',
  'This looks like a newer version of {file}.': 'Parece una versión más reciente de {file}.',
  'We read it the same way as last time.': 'Lo leímos igual que la última vez.',
  '{n} new': '{n} por añadir',
  '{n} updated': '{n} con cambios',
  '{n} unchanged': '{n} sin cambios',
  '{records} will be added.': 'Por añadir: {records}.',
  '1 of these have nothing that identifies them (like an order number), so we can’t tell whether they’re already in your data.':
    'Uno de ellos no tiene nada que lo identifique (como un número de pedido), así que no podemos saber si ya está en tus datos.',
  '{n} of these have nothing that identifies them (like an order number), so we can’t tell whether they’re already in your data.':
    '{n} de ellos no tienen nada que los identifique (como un número de pedido), así que no podemos saber si ya están en tus datos.',
  '{records} will be updated, for example:': 'Con cambios: {records}. Por ejemplo:',
  '{records} from last time aren’t in the new files.':
    'Estaban la última vez, pero no en los archivos nuevos: {records}.',
  'We’ll keep them, so nothing is lost.': 'Los conservamos, así que no se pierde nada.',
  'For example: {examples}.': 'Por ejemplo: {examples}.',
  '1 appear more than once in the new files; we used the first one each time.':
    'Uno aparece más de una vez en los archivos nuevos; usamos el primero.',
  '{n} appear more than once in the new files; we used the first one each time.':
    '{n} aparecen más de una vez en los archivos nuevos; en cada caso usamos el primero.',
  'You changed some of these here': 'Cambiaste algunos de estos aquí',
  'The new files say something different. Choose which to keep. If you don’t choose, we keep yours.':
    'Los archivos nuevos dicen otra cosa. Elige cuál conservar. Si no eliges, conservamos lo tuyo.',
  'Keep yours': 'Conservar lo tuyo',
  'Take the file’s': 'Usar lo del archivo',
  blank: 'vacío',
  'Update my data': 'Actualizar mis datos',
  'Don’t update': 'No actualizar',

  // The review (“Here’s what we found”)
  'Here’s what we found': 'Esto es lo que encontramos',
  'Updating with your changes…': 'Actualizando con tus cambios…',
  'We used our standard checks instead.': 'En su lugar, usamos nuestras comprobaciones habituales.',
  'What changed': 'Qué cambió',
  'Needs a quick look': 'Necesita un vistazo',
  'If you skip this, we’ll go with “{option}”.': 'Si lo omites, elegiremos “{option}”.',
  'What we’ll bring in': 'Lo que vamos a importar',
  'We couldn’t match these files to a shop’s usual records yet. Tell us below what they hold (for example “these are my sales”).':
    'Todavía no pudimos relacionar estos archivos con los registros habituales de una tienda. Cuéntanos abajo qué contienen (por ejemplo, “estas son mis ventas”).',
  'What we’ll skip': 'Lo que vamos a omitir',
  '{sheet} line {line}: {text}': '{sheet}, línea {line}: {text}',
  '(blank)': '(vacío)',
  'Things we assumed': 'Lo que supusimos',
  'Please check': 'Revísalo',
  'You told us:': 'Nos dijiste:',
  'Anything look wrong?': '¿Algo no se ve bien?',
  'Tell me in your own words, e.g. “the Etsy prices include shipping”.':
    'Cuéntamelo con tus palabras, p. ej., “los precios de Etsy incluyen el envío”.',
  'Tell us what looks wrong': 'Cuéntanos qué no se ve bien',
  'Fix it': 'Corregirlo',
  'Looks good, compare with my data': 'Todo bien, compáralo con mis datos',
  'Looks good, set it up': 'Todo bien, prepáralo',
  'Start over with different files': 'Empezar de nuevo con otros archivos',
  'From {sources} and {n} more': 'De {sources} y {n} más',
  'From {sources}': 'De {sources}',
  '{n} duplicates merged': 'Duplicados combinados: {n}',
  'Show details': 'Ver detalles',
  'What {heading} really is': 'Qué es realmente {heading}',
  'This is actually…': 'En realidad es…',
  'Don’t bring this in': 'No importar esto',
};
