# Animazioni WebM delle attività NPC

Se la scheda NPC è già modificabile sul sito, puoi aggiungere o sostituire il WebM principale anche a mondo chiuso o con Automated Animations disattivato.

## Utilizzo

Aprire la capacità o l'incantesimo nella scheda NPC ed espandere **Animazione** per riprodurre il video. In **Modifica**, selezionare l'attività e aprire **Animazione**. Si può attivare l'effetto, regolare la velocità oppure caricare un WebM fino a 16 MiB. **Salva modifiche** mette il comando in coda. Foundry lo applica alla prossima sincronizzazione in ingresso. Per riprodurre l'effetto sui token, attivare Automated Animations e le sue dipendenze nel mondo.

Per gli attacchi si possono regolare il numero totale di riproduzioni e l'intervallo in millisecondi. Gli effetti su token e sagome hanno anche **Effetto persistente (loop in scena)**. Disattivandolo si torna alle ripetizioni impostate. Le aure sono sempre persistenti. Per **Emendamento** di Leonora, scegliere l'attività **Tiro salvezza**.

Se il WebM caricato contiene una traccia audio, l'attività usa automaticamente lo stesso file per il video e il suono. Per silenziare l'abilità, disattivare **Audio del WebM** e premere **Salva modifiche**. La scelta vale anche quando si sostituisce il video. Un WebM privo di audio può essere usato per la sola animazione.

Per i WebM già assegnati dal sito, Wiki Sync 0.11.22 controlla la traccia al primo allineamento del client GM con la sincronizzazione in ingresso attiva. L'audio si abilita anche per queste attività, senza ricaricare il file. Un file audio già scelto, il silenziamento di una traccia e la modalità solo suono mantengono le impostazioni salvate.

Se l'attività ha già un file audio personalizzato, conserva la scelta. **Usa l’audio del WebM** passa alla traccia incorporata. Per usare un'altra traccia, attivare il suono e inserire un percorso accessibile a Foundry o un URL nel campo **File audio in Foundry**. Il volume, le ripetizioni e l'intervallo del suono si regolano separatamente dal video. **Riproduci solo il suono** conserva la propria traccia.

Se il menu di un'animazione creata in precedenza dal sito dà errore in Foundry, aprire **Modifica → attività interessata → Animazione** sul sito. Quando la configurazione è incompleta compare **Ripara menu Foundry**. Sceglierlo, premere **Salva modifiche** e riaprire il menu dopo la sincronizzazione. La riparazione completa i campi dell'attività selezionata e conserva il WebM assegnato.

Se l'ultimo snapshot conferma il supporto alla copia dei WebM, Wiki Sync scarica e verifica il file nel mondo. Con uno snapshot precedente, Foundry riceve un collegamento al video sul sito e lo carica via Internet al momento della riproduzione. Per vedere sul sito un video presente soltanto nel mondo, Wiki Sync 0.11.21 deve prima trasferirlo.

Il WebM usa `system.activities.<id>.flags.autoanimations.primary.video.customPath` con `enableCustom` attivo. Le impostazioni di riproduzione e audio sono salvate negli stessi flag nativi dell'attività, in `primary.options`, `primary.sound` e `soundOnly.sound`. Gli effetti secondari e i riferimenti al catalogo JB2A restano nella configurazione nativa.

## Attivazione

1. Pubblicare il Worker e gli asset del sito da questa revisione. Il Worker usa il bucket R2 già configurato e la coda NPC esistente.
2. Per trasferire i file locali e attivare l'audio dei caricamenti precedenti, a mondo chiuso estrarre `dist/cripta-wiki-sync-0.11.22.zip` nella cartella `Data/modules/cripta-wiki-sync`. Il file `module.json` deve trovarsi direttamente in quella cartella.
3. Per sincronizzare in entrambe le direzioni, avviare il client GM con Wiki Sync in modalità **Bidirezionale**. Il primo avvio della 0.11.21 controlla gli NPC già condivisi. Le successive sincronizzazioni verificano il contenuto del file anche quando il nome resta uguale.

La patch completa `integrations/cripta-wiki-sync/activity-animations-0.11.21.patch` si può applicare con `git apply` a una copia del modulo 0.11.20. Comprende il manifest e tutti i servizi necessari.
Su una copia della 0.11.21, `git apply integrations/cripta-wiki-sync/activity-audio-0.11.22.patch` aggiunge il recupero dell'audio.

## Verifica

Eseguire `node --experimental-default-type=module scripts/test-npc-activity-animations.mjs`. Il test accetta come argomenti opzionali il percorso del WebM di Leonora e il JSON nativo del suo Item **Colpo del Demone**. Usa il codice del Worker e del modulo con archivi locali di prova.
