require('dotenv').config()

const fs = require('firebase-admin');

const serviceAccount =  {
    "type": process.env.TYPE,
    "project_id": process.env.PROJECT_ID,
    "private_key_id": process.env.PRIVATE_KEY_ID,
    "private_key":process.env.PRIVATE_KEY ,
    "client_email": process.env.CLIENT_EMAIL,
    "client_id": process.env.CLIENT_ID,
    "auth_uri": process.env.AUTH_URI,
    "token_uri": process.env.TOKEN_URI,
    "auth_provider_x509_cert_url": process.env.AUTH_PROVIDER_X509_CERT_URL,
    "client_x509_cert_url":  process.env.CLIENT_X509_CERT_URL,
    "universe_domain": process.env.UNIVERSE_DOMAIN
}

console.log(serviceAccount)

fs.initializeApp({
 credential: fs.credential.cert(serviceAccount)
});

const db = fs.firestore(); 

const  cogoone_constants = db.collection('cogoone_constants').doc('IzVhMjQAJ7On78yV8V5b').get(); 

cogoone_constants.then((res)=> {
    console.log(res.data())
})

// module.exports = {
//     firestoreDB: db
// }