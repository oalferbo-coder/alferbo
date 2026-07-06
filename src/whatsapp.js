// Envio de mensajes por WhatsApp via Twilio.
// Si las credenciales no estan configuradas, los mensajes se registran en consola
// (modo simulacion) para poder probar la app sin cuenta de Twilio.
require('dotenv').config();

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM } = process.env;

let client = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  client = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

function normalizePhone(phone) {
  const digits = phone.replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
}

async function sendWhatsApp(phone, body) {
  const to = `whatsapp:${normalizePhone(phone)}`;
  if (!client) {
    console.log(`[whatsapp:simulado] -> ${to}\n${body}\n`);
    return { simulated: true, to };
  }
  return client.messages.create({ from: TWILIO_WHATSAPP_FROM, to, body });
}

module.exports = { sendWhatsApp, normalizePhone };
