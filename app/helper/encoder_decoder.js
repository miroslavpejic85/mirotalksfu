require('dotenv').config()
const  CryptoJS = require('crypto-js');

const decrypt_encrypt_password = process.env.DECRYPT_ENCRYPT_PASSWORD || '@MrCogoport'
const encrypt = (content, password = decrypt_encrypt_password) => encodeURIComponent(CryptoJS.AES.encrypt(JSON.stringify({ content }), password).toString())
const decrypt = (crypted, password = decrypt_encrypt_password) => JSON.parse(CryptoJS.AES.decrypt(decodeURIComponent(crypted), password).toString(CryptoJS.enc.Utf8)).content

// password = '23454567'
// const content = {
//     name: "Abhijit",
//     user_id: "123456YUIoew",
//     room_id: "3456789dewhgtu57612890"
// }
// encrypt_data = encrypt( content, password )
// decrypt_data = decrypt( encrypt_data, password )
// console.log(encrypt_data, decrypt_data)

module.exports = {
    encrypt,
    decrypt
}