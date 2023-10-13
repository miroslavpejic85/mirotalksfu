const { RubyClient, RubyClientUser } = require("./RubyClient")

module.exports =  class RubyApiCall{
    constructor(){
        this.ruby_api_call = async (data) => await RubyClient(data)
        this.ruby_api_call_by_user = async (data) => await RubyClientUser(data)
    }

    async userAuthenticate({auth_token}){
        let params={
            request_api_path: 'get_user',
            request_auth_token: auth_token,
            request_auth_scope: 'partner'
        }

        let request_type='GET'
        let path = '/auth/verify_request'
        let api_response = await this.ruby_api_call_by_user({path, request_type, params})

        if (api_response?.is_authenticated){
            return true
        }

        return false
    }


}