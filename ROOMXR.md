Preparativi
===========
sudo update-rc.d apache2 disable
sudo iptables -t nat -I PREROUTING -p tcp --dport 443 -j REDIRECT --to-ports 5001

la seconda operazione va effettuata ad ogni riavvio... bisogna cercare di metterla in schedule nel sistema...

Certificati
===========
certbot aggiorna in automatico i cetificati, ma ogni tre mesi va riavviato RoomXR e soprattutto vanno copiati i certificati con questi comandi:
sudo cp /etc/letsencrypt/live/roomxr.eu/privkey.pem /home/enzo_francesca/keys/
sudo cp /etc/letsencrypt/live/roomxr.eu/fullchain.pem /home/enzo_francesca/keys/



Motori esterni
==============
- fabricjs per la whiteboard, https://github.com/exceptionnotfound/FabricJSDrawingWalkthrough è un esempio per i tool da costruirci sopra

Aggiornamento codice sorgente
=============================
RoomXR è un fork di un progetto (MirotalkSFU) che risiede su GitHub.  
Quando gli aggiornamenti sul server principale sono consistenti è preferibile  
fare un merge sul nostro fork.
- Per prima cosa bisogna fare una pull request
- poi bisogna seguire le istruzioni manuali alla fine della pagine della pull
- queste istruzioni considerano di essere nella cartella gittata del nostro server  
preferisco fare un clone su disco e poi seguire le istruzioni, che sostanzialmente fanno scaricare tutte le nuove  
modifiche su un branch nuovo a questo punto si possono editare i conflitti con visual studio code e poi mergiare  
tutto di nuovo e pushare sul server una volta terminato
- sul server R&D bisognerà fare un pull delle modifihe e lanciare un PYTHON=python3.7 npm install  
per installare e compilare tutto, avendo l'accortezza di stoppare il servizio PM2