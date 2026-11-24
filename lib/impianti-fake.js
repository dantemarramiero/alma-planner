// Casella Outlook finta per «Da fare · In attesa di risposta» di Alma Impianti, in locale e nei test (senza Microsoft 365).
// Stessa forma delle risposte di Graph usate da routes/impianti.js.
const day = n => new Date(Date.now() - n * 864e5).toISOString();
const rcpt = (name, address) => ({ emailAddress: { name, address } });

function createImpiantiMailFake() {
  const sent = [
    // senza risposta da 8 giorni: in attesa
    { id: 'imp-out-1', conversationId: 'conv-fondo', subject: 'Biometano Lucera: vi interessa?', sentDateTime: day(8), toRecipients: [rcpt('Laura Neri', 'l.neri@fondoverde-esempio.it')], webLink: null },
    // senza risposta da 12 giorni: in attesa
    { id: 'imp-out-2', conversationId: 'conv-progettista', subject: 'Preventivo tetto FV 2,4 MWp', sentDateTime: day(12), toRecipients: [rcpt('Ing. Bianchi', 'bianchi@bianchi-associati.it')], webLink: null },
    // ha risposto: non compare
    { id: 'imp-out-3', conversationId: 'conv-risposta', subject: 'Sopralluogo depuratore', sentDateTime: day(10), toRecipients: [rcpt('Paolo Rossi', 'p.rossi@studiotecnicorossi-esempio.it')], webLink: null },
    // troppo recente: non compare ancora
    { id: 'imp-out-4', conversationId: 'conv-recente', subject: 'Proposta diagnosi energetica', sentDateTime: day(1), toRecipients: [rcpt('Ufficio tecnico', 'tecnico@cartiera-esempio.it')], webLink: null },
    // a una persona fuori dal CRM: non compare
    { id: 'imp-out-5', conversationId: 'conv-fuori', subject: 'Cena di Natale', sentDateTime: day(9), toRecipients: [rcpt('Amico', 'amico@gmail.com')], webLink: null },
  ];
  const inbox = [
    { conversationId: 'conv-risposta', from: rcpt('Paolo Rossi', 'p.rossi@studiotecnicorossi-esempio.it'), receivedDateTime: day(9) },
  ];
  return {
    sent, inbox,
    async graphAll(_t, path) { return path.includes('sentitems') ? sent : inbox; },
  };
}

module.exports = { createImpiantiMailFake };
