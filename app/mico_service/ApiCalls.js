const { isEmpty } = require("../helper/isEmpty")
const { RubyClient, RubyClientUser, CogoVerseClient } = require("./ApiClients")

module.exports =  class RubyApiCall{
    constructor(){
        this.ruby_api_call = async (data) => await RubyClient(data)
        this.ruby_api_call_by_user = async (data) => await RubyClientUser(data)
        this.cogoverse_api_call = async (data) => await CogoVerseClient(data)
    }

    async userAuthenticate({auth_token}){
        let params={
            request_api_path: 'get_user',
            request_auth_token: auth_token,
            request_auth_scope: 'partner'
        }

        let api_response = await this.ruby_api_call_by_user({path: '/auth/verify_request', request_type: 'GET', params})

        if (api_response?.is_authenticated){
            return true
        }

        return false
    }

    async videoCallAction({user_ids, meeting_id, video_call_action, additional_data}){

        if (isEmpty(user_ids) || isEmpty(meeting_id) || isEmpty(video_call_action) || isEmpty(additional_data)){
            return false
        }

        let body = {
            "user_ids": user_ids,
            "meeting_id": meeting_id,
            "video_call_action": video_call_action,
            "additional_data": additional_data
        }

        let api_response = await this.cogoverse_api_call({path: '/video_conference_actions', request_type: 'POST', body})

        return api_response
    }

}