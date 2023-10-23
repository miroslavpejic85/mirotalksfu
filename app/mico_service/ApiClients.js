const { isEmpty } = require('../helper/isEmpty');
const axios = require('axios')

require('dotenv').config()


async function RubyClient({path='/', body={}, params={}, request_type='GET'}) {
    try {
        const arg = {
            method: request_type,
            url: process.env.RUBY_ADDRESS_URL+path,
            headers: {
                'Authorization': 'Bearer: ' + process.env.RUBY_AUTHTOKEN,
                'AuthorizationScope': process.env.RUBY_AUTHSCOPE,
                'AuthorizationScopeId': process.env.RUBY_AUTHSCOPEID,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
        }

        if (!isEmpty(body)){
            arg['data'] = JSON.stringify(body)
        }

        if (!isEmpty(params)){
            arg['params'] =  params
        }

        const response = await axios(arg)
        console.log('Data:', response.data);
        return response.data
        
    } catch (error) {
        console.error('Error fetching data:', error);
        return {}
    }
}

async function RubyClientUser({path='/', body={}, params={}, request_type='GET', headers = {}}) {
    try {
        const arg = {
            method: request_type,
            url: process.env.RUBY_ADDRESS_URL+path,
            headers: {
                ...headers,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
        }

        if (!isEmpty(body)){
            arg['data'] = JSON.stringify(body)
        }

        if (!isEmpty(params)){
            arg['params'] =  params
        }

        const response = await axios(arg)
        console.log('Data:', response.data);
        return response.data
        
    } catch (error) {
        console.error('Error fetching data:', error);
        return {}
    }
}

async function CogoVerseClient({path='/', body={}, params={}, request_type='GET'}) {
    try {
        const arg = {
            method: request_type,
            url: process.env.COGOVERSE_ADDRESS_URL+path,
            maxBodyLength: Infinity,
            headers: { 
                'Content-Type': 'application/json'
            },
        }

        if (!isEmpty(body)){
            arg['data'] = JSON.stringify(body)
        }

        if (!isEmpty(params)){
            arg['params'] =  params
        }

        const response = await axios(arg)
        console.log('Data:', response.data);
        return response.data
        
    } catch (error) {
        console.error('Error fetching data:', error);
        return {}
    }
}

module.exports = {
    RubyClient,
    RubyClientUser,
    CogoVerseClient
}