/** Spanish for emails, downloads and reports written by core services (M20). */
export const emails: Record<string, string> = {
  // Account and invitations.
  'Reset your BizRetriever password': 'Restablece tu contraseña de BizRetriever',
  "Hi {name},\n\nUse this link to choose a new password:\n{url}\n\nIf you didn't ask for this, you can ignore this email.":
    'Hola, {name}:\n\nUsa este enlace para elegir una contraseña nueva:\n{url}\n\nSi no lo pediste, puedes ignorar este correo.',
  'Confirm your email for BizRetriever': 'Confirma tu correo para BizRetriever',
  'Hi {name},\n\nPlease confirm your email address:\n{url}\n\nThanks!':
    'Hola, {name}:\n\nConfirma tu dirección de correo:\n{url}\n\n¡Gracias!',
  '{who} invited you to {business} on BizRetriever': '{who} te invitó a {business} en BizRetriever',
  '{who} invited you to see {business} on BizRetriever.\n\nJoin here (the link works for 7 days):\n{link}\n':
    '{who} te invitó a ver {business} en BizRetriever.\n\nÚnete aquí (el enlace funciona durante 7 días):\n{link}\n',
  '{who} invited you to help run {business} on BizRetriever.\n\nJoin here (the link works for 7 days):\n{link}\n':
    '{who} te invitó a ayudar a llevar {business} en BizRetriever.\n\nÚnete aquí (el enlace funciona durante 7 días):\n{link}\n',

  // Weekly summary and urgent alerts.
  'Hi {name},': 'Hola, {name}:',
  'You get this weekly summary because you’re part of {business} on BizRetriever.':
    'Recibes este resumen semanal porque formas parte de {business} en BizRetriever.',
  'You get these alerts because you’re part of {business} on BizRetriever.':
    'Recibes estas alertas porque formas parte de {business} en BizRetriever.',
  'Choose which emails you get': 'Elige qué correos recibes',
  '({change} on the week before)': '({change} respecto a la semana anterior)',
  'Here’s how {business} did in the week of {week}:':
    'Así le fue a {business} en la semana del {week}:',
  'Your goals:': 'Tus objetivos:',
  'Handed to you:': 'Te lo pasaron a ti:',
  'Worth a look:': 'Vale la pena mirar:',
  'Try asking:': 'Prueba a preguntar:',
  'See everything:': 'Ver todo:',
  'Open BizRetriever': 'Abrir BizRetriever',
  '{business}: your week of {week}': '{business}: tu semana del {week}',
  '{business}: {n} things need a look': '{business}: {n} cosas necesitan tu atención',
  'This needs a look:': 'Esto necesita tu atención:',
  'These need a look:': 'Esto necesita tu atención:',
  '…and {n} more.': '…y {n} más.',
  'See the details:': 'Ver los detalles:',
  'See the details': 'Ver los detalles',

  // Mentions and handovers.
  'an insight': 'un hallazgo',
  'an answer': 'una respuesta',
  '{who} mentioned you in {business}': '{who} te mencionó en {business}',
  '{who} mentioned you on “{title}”:': '{who} te mencionó en “{title}”:',
  'See it': 'Verlo',
  'The owner': 'El propietario',
  They: 'Esa persona',
  '{who} wants to make you the owner of {business}':
    '{who} quiere hacerte propietario de {business}',
  "{who} has asked you to become the owner of {business} on BizRetriever. As the owner you'd decide who is part of the business, and could delete it. Nothing changes until you accept, within {days} days, in Settings:":
    '{who} te pidió que seas el propietario de {business} en BizRetriever. Como propietario decidirías quién forma parte del negocio y podrías eliminarlo. Nada cambia hasta que aceptes, en un plazo de {days} días, en Configuración:',
  '{who} is now the owner of {business}': '{who} ahora es el propietario de {business}',
  "{who} accepted, and is now the owner of {business}. You're still part of the business, as a member.":
    '{who} aceptó y ahora es el propietario de {business}. Sigues formando parte del negocio, como miembro que puede editar.',
  '{who} didn’t take over {business}': '{who} no aceptó quedarse con {business}',
  "{who} said no, so you're still the owner of {business}.":
    '{who} dijo que no, así que sigues siendo el propietario de {business}.',

  // Scheduled reports.
  'Your dashboard, with today’s numbers.': 'Tu panel, con los números de hoy.',
  'Here’s your report for {business}: “{title}”.':
    'Aquí tienes tu informe de {business}: “{title}”.',
  'It’s attached as a PDF, worked out from your data today.':
    'Va adjunto en PDF, calculado hoy con tus datos.',
  'See it in BizRetriever': 'Verlo en BizRetriever',
  'You get this {when}.': 'Lo recibes {when}.',
  'Stop it:': 'Cancelarlo:',

  // Downloads and PDFs.
  'Shows {shown} of {total} rows. The Excel download has more.':
    'Se muestran {shown} de {total} filas. La descarga de Excel tiene más.',
  'Shows {n} of {total} rows.': 'Se muestran {n} de {total} filas.',
  '{business} dashboard': 'Panel de {business}',
  '{range}, compared with {other}': '{range}, comparado con {other}',
  'The first {n} of {total} records.': 'Los primeros {n} de {total} registros.',
  '1 record.': '1 registro.',
  '{n} records.': '{n} registros.',
  'How it was worked out': 'Cómo se calculó',
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
  Business: 'Negocio',
  Yes: 'Sí',
  No: 'No',
  'All time': 'Todo el tiempo',
  'Couldn’t load this.': 'No se pudo cargar.',
};
