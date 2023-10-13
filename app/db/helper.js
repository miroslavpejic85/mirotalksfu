let  { FieldValue } = require('firebase-admin/firestore');


function getMeetingRoom({firestoreDB, room_id = ''}){
    return firestoreDB.collection("video_conference").doc(room_id).get()
}

function updateMeetingRoom({firestoreDB, room_id, data_to_update}){
    if (room_id  && data_to_update){
        let video_conference_ref = firestoreDB.collection("video_conference").doc(room_id);
        video_conference_ref.set(data_to_update, { merge: true })
    }
}

function updateUserCount({firestoreDB, user_list = [], room_id}){
    if (room_id && user_list){
        let video_conference_ref = firestoreDB.collection("video_conference").doc(room_id);
        let now_time = new Date().getTime() / 1000
    
        let users_in_meeting = {}
    
        for (user of user_list){
            if (users_in_meeting[user.user_id]){
                users_in_meeting[user.user_id] += 1 
            }else{
                users_in_meeting[user.user_id] = 1
            }
        }
    
        video_conference_ref.update({
            updated_at: now_time,
            users_in_meeting: users_in_meeting,
            user_count_in_meeting: user_list.length
        })
    }
}

function joinMeetingUpdate({firestoreDB, room_id, user_id, user_name}){
    if (user_id && room_id){
        let video_conference_user_ref = firestoreDB.collection("video_conference").doc(room_id).collection('user').doc(user_id)
        let now_time = new Date().getTime() / 1000

        video_conference_user_ref.set({
            user_name: user_name,
            join_at: now_time,
            updated_at: now_time,
            activity_time_lines : FieldValue.arrayUnion({
                action: 'join_meeting',
                join_at: now_time,
            })
        }, { merge: true })
    }
}

function leaveMeetingUpdate({firestoreDB, room_id, user_id, user_name}){
    if(user_id && room_id){
        let video_conference_user_ref = firestoreDB.collection("video_conference").doc(room_id).collection('user').doc(user_id)
        let now_time = new Date().getTime() / 1000

        video_conference_user_ref.set({
            user_name, user_name,
            leave_at: now_time,
            updated_at: now_time,
            activity_time_lines : FieldValue.arrayUnion({
                action: 'leave_meeting',
                join_at: now_time,
            })
        }, { merge: true })
    }
}


module.exports = {
    getMeetingRoom,
    updateMeetingRoom,
    joinMeetingUpdate,
    leaveMeetingUpdate,
    updateUserCount
}