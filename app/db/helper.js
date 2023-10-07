function getMeetingRoom({firestoreDB, room_id}){
    return firestoreDB.collection("internal").doc("cogo_one").collection("internal_chats").doc(room_id).get()
    // return firestoreDB.collection('video_call').doc(room_id).get();
}



module.exports = {
    getMeetingRoom
}