const { RubyClient, RubyClientUser } = require("./RubyClient")

module.exports =  class RubyApiCall{
    constructor(){
        this.ruby_api_call = async (data) => await RubyClient(data)
        this.ruby_api_call_by_user = async (data) => await RubyClientUser(data)
    }

    async userAuthenticate(){
        let params={
            request_api_path: 'get_user',
        }
        let headers ={
            // AuthorizationScope: 'partner',
            Authorization: 'Bearer: ' + 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE2OTczNDkzOTcsImlhdCI6MTY5NzE3NjU5NywiVXNlclNlc3Npb25JRCI6ImEyYzYxNmI0LTkyYmYtNDMxNy04MTUwLWVjOThlYzljZjQ4OCJ9.BNlUGZJ9FbJeHZa5CtQgz3CVHW-zrZnvrxFw74vk9A92kM3pQy93idGZPFBx3t9PYVs4FrIs8bZ71lu2I0nz9Q'
        }

        let request_type='GET'
        let path = '/auth/verify_request'
        let api_response = await this.ruby_api_call_by_user({path, request_type, params, headers})

        return api_response
    }


}