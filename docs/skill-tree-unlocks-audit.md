# Verifica sblocchi degli alberi condivisi — 29 settembre 2026

Verificati FE e API con test isolati, senza modificare i dati delle campagne. Le correzioni sono locali: occorre pubblicare FE e Worker aggiornati.

## Problemi riprodotti e corretti

- **Salvataggi senza versione:** il FE inviava tutta la raccolta `skill-tree-states` senza `expectedVersion`. Una scheda rimasta aperta poteva sovrascrivere progressi più recenti. Ora ogni scrittura porta la versione caricata; il Worker rifiuta versioni mancanti/obsolete. Se la lettura iniziale è fallita, non è permesso salvare una raccolta vuota di ripiego. Il conflitto chiede di ricaricare, senza tentare sovrascritture automatiche.
- **Record condivisi duplicati:** il FE univa gli sblocchi di tutti i record, riesumando nodi disattivati e valori rimossi. Ora legge lo snapshot completo più recente; a parità di data preferisce l'identificativo canonico. Un normale salvataggio consolida i record dello stesso albero, preservando gli altri.
- **Modifica locale dopo un errore:** sblocco, livello e requisiti venivano modificati prima della richiesta e rimanevano in memoria anche in caso di errore. Ora la vista torna allo stato precedente. Il messaggio non presume che un errore di rete significhi mancata scrittura sul server: chiede di rileggere i progressi.
- **Clic e salvataggi sovrapposti:** un'azione in corso blocca ulteriori modifiche ai progressi dello stesso albero; le scritture degli alberi della stessa pagina sono serializzate, usando di volta in volta lo stato e la versione aggiornati.
- **Protezione incompleta degli stati condivisi:** l'API ora riconosce anche il soggetto `__campaign__`, gli alberi dichiarati condivisi nella definizione e gli identificativi riservati già presenti. Un record personale non può impersonare lo stato condiviso, neppure omettendo il flag `shared`. Il FE verifica l'ambito e la chiave dell'albero prima di accettare uno stato condiviso.

Gli sblocchi condivisi rimangono riservati agli editor della campagna (DM e admin); i normali giocatori conservano la modifica dei propri alberi personali. Questo permesso è distinto dalla configurazione admin delle probabilità dei dadi.

## Riscontro online in sola lettura

Lette esclusivamente le raccolte pubbliche `skill-trees` e `skill-tree-states` dall'API configurata nel progetto.

- Cripta di Sangue: 9 alberi, nessuno dichiarato condiviso; versioni raccolte 351 e 256.
- Mago Folle: 9 alberi, nessuno dichiarato condiviso; versioni 104 e 31.
- Oltre il Velo: 10 alberi, due condivisi; versioni 271 e 166.

I due alberi condivisi sono **Progetto di Espansione: Miniera di Lunarmana** e **Progetto di Restauro: Il Portale dei Khul**. Alla lettura, ciascuno aveva un solo record condiviso e un solo nodo sbloccato, senza identificativi nodo duplicati. Non sono state rilevate duplicazioni di stato già presenti su questi due alberi.

In entrambi, il nodo `inizio` è marcato come sbloccato nel modello iniziale ma è assente dallo stato salvato. La logica usa correttamente lo stato salvato quando esiste: quindi **Fondamenta a Risonanza Planare** e **Stabilizzatore Armonico** risultano disponibili, mentre i relativi discendenti restano bloccati. Non è possibile dedurre dalla sola lettura se sia una scelta del DM o l'esito di una precedente sovrascrittura; nessun progresso reale è stato corretto automaticamente.

## Verifiche e limiti

`npm run test:skill-trees`: 35 casi su lettura condivisa, versione, rete, scritture ravvicinate, handler reali dell'interfaccia, requisiti tutti/uno, scelte esclusive, gruppi, livelli, permessi e separazione delle campagne. Superati anche i test preesistenti admin e API probabilità dei dadi.

I test dell'interfaccia eseguono le funzioni reali con dati fittizi; non sono stati azionati sblocchi nelle campagne online.

La versione protegge dalle copie obsolete rilevate dal Worker; **KV non offre una transazione atomica di confronto e scrittura**. Resta un limite per richieste perfettamente simultanee da dispositivi diversi o letture KV non ancora allineate. Una garanzia rigorosa richiederebbe spostare le scritture in un archivio/coordinatore transazionale; questa verifica non introduce tale migrazione.

Pubblicare insieme FE e Worker: il nuovo endpoint rifiuta i vecchi client che salvano senza versione. Aggiornati i riferimenti di cache sia della scheda legacy sia di quella gestita.
