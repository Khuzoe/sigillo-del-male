# Editor completo NPC · campagna pilota

La modalità Modifica usa il JSON nativo sincronizzato da Wiki Sync per Cripta di Sangue. Le altre campagne e gli NPC senza snapshot mantengono l’editor precedente. Dossier, immagini, alberi e catalogo continuano a usare i rispettivi percorsi esistenti. Le nuove capacità AI di Cripta usano anche questo editor in modalità bozza: vedere [integrazione AI](npc-ai-editor.md). Le bozze AI precedenti restano disponibili con il loro editor originale.

L’editor comprende statistiche, caratteristiche, competenze, capacità, incantesimi, inventario, effetti dell’Actor ed effetti incorporati negli oggetti. Ha ricerca, descrizione formattata, attività multiple, componenti dei danni, TS, cure, condizioni, durata e un editor ad albero per i campi dei moduli. La sezione Avanzato conserva nomi originali e tipi di valore. Le attività nuove guidate possono essere attacco, TS, danni, cura o utilità. I dati non esposti non vengono sostituiti.

Le creazioni/eliminazioni di oggetti e le creazioni di effetti dell’Actor restano negli strumenti esistenti. Gli effetti incorporati negli oggetti si possono modificare o disattivare; per crearli o eliminarli si usa ancora Foundry. Il formato delle automazioni di terze parti rimane quello del modulo: non viene inventato un compilatore universale.

Identità dei documenti, ownership, `_stats`, provenienza, avanzamenti generati, configurazione dei token e campi di sistema derivati sono protetti. Per Actor con stato per token, PF attuali/temporanei e slot consumati non sono modificabili dal documento condiviso. Le probabilità restano visibili e modificabili soltanto dall’account admin globale, anche attraverso le API e i riepiloghi della coda.

I vecchi import possono usare chiavi delle attività diverse dal loro `_id` o elenchi al posto di mappe: l’editor le indirizza con l’identificativo stabile, conservando lo snapshot grezzo. Quando più attività condividono lo stesso `_id`, non sceglie quale eliminare: nome e descrizione restano modificabili, mentre le meccaniche sono bloccate con una spiegazione finché il problema non viene corretto in Foundry. La verifica sui 76 snapshot ricevuti comprende 651 oggetti e 95 effetti; non ha eseguito scritture remote.

## Salvataggio

- `GET /api/managed-actors/:world/:actor/editor?campaign=cripta-di-sangue`: proiezione modificabile, privata, per DM/admin o proprietario del companion. Non concede lettura del JSON completo grezzo.
- `POST` sullo stesso endpoint: versione 1, UUID di richiesta, elenco di destinazioni e differenze per campo (`set`/`delete`, presenza e valore iniziali). Una richiesta non valida non accoda nessuna parte del gruppo.
- La coda D1 esistente conserva comandi con `nativeEditorVersion: 1`. Nessun aggiornamento al vecchio archivio KV o alle copie originali. Lo snapshot viene aggiornato soltanto da Foundry.
- Campi cambiati nel frattempo producono un conflitto. Ritentare una richiesta ancora in coda restituisce gli stessi comandi. Un elemento con invio pendente resta bloccato fino alla sincronizzazione; “Aggiorna scheda” aggiorna i dati lasciando le bozze non inviate.
- Wiki Sync confronta la sorgente persistente, valida un documento staccato mediante i modelli installati, usa gli adattatori v14 per attività/preset e verifica il risultato. Se l’applicazione fallisce tenta il ripristino dei campi toccati e comunica eventuali problemi di ripristino.
- Il gruppo viene accodato atomicamente; l’applicazione di più documenti in Foundry rimane per singolo comando, con esiti distinti.

## Attivazione

Serve Wiki Sync 0.11.15 (servizi `npc-native-editor.mjs`, `npc-native-model.mjs` e aggiornamento del servizio snapshot). La capacità viene dichiarata da `snapshot.versions.nativeEditor = 1`; non si deduce dal numero di versione in cache del server. Il primo avvio aggiorna automaticamente gli snapshot della sola campagna pilota che non dichiarano ancora questa capacità. Finché non arriva, il sito mostra la scheda ma blocca l’invio e indica di ricaricare Foundry.

La patch `integrations/cripta-wiki-sync/npc-sheet-editor-0.11.15.patch` si applica al modulo 0.11.14 con `git apply`; il file condiviso `npc-native-model.mjs` deve essere identico a `assets/js/shared/npc-native-model.mjs`. Nessuna modifica ai dati del mondo è necessaria per installare questi file.

## Verifica

`npm run test:npc-sheet-editor` verifica differenze, campi riservati, riservatezza admin, conflitti, idempotenza, modifiche degli effetti v14, validazione della coda e preservazione di KV/snapshot. Usare anche i test di snapshot, storage NPC, companion e i test di roundtrip passando il percorso del modulo installato. Le prove nel browser impiegano fixture locali con API simulate; non eseguono salvataggi su NPC reali né generazioni a pagamento.
