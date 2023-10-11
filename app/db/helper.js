function getMeetingRoom({firestoreDB, room_id}){
    return firestoreDB.collection("video_conference").doc(room_id).get()
    // return firestoreDB.collection('video_call').doc(room_id).get();
}



module.exports = {
    getMeetingRoom
}