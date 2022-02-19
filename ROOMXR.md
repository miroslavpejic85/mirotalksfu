Preparativi
===========
sudo update-rc.d apache2 disable
sudo iptables -t nat -I PREROUTING -p tcp --dport 443 -j REDIRECT --to-ports 5001


Motori esterni
==============
- fabricjs per la whiteboard, https://github.com/exceptionnotfound/FabricJSDrawingWalkthrough è un esempio per i tool da costruirci sopra

