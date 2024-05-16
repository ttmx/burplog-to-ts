import { XMLParser } from 'fast-xml-parser';
import Bun from 'bun';
import {
	quicktype,
	InputData,
	jsonInputForTargetLanguage,
} from 'quicktype-core';


const burpLog = Bun.file('burplog.xml')
const host = Bun.argv[2]

const parser = new XMLParser();
const xmlObj = parser.parse(await burpLog.text())

// console.log(xmlObj.items.item[0])

const reqsPerPath = new Map<string, Map<Method,BurpItem[]>>()
for (let i = 0; i < xmlObj.items.item.length; i++) {
	const req = xmlObj.items.item[i] as BurpItem;
    
	if (req.host === host) {
		const path = req.path.split('?')[0]
		const method = req.method
		let pathMap = reqsPerPath.get(path)
		if(!pathMap){
			pathMap = new Map()
			reqsPerPath.set(path,pathMap)
		}
		let methodList = pathMap.get(method)
		if(!methodList){
			methodList = []
			pathMap.set(method,methodList)
		}
		methodList.push(req)
	}
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD' | 'TRACE' | 'CONNECT'
interface BurpItem {
	time: string;
	url: string;
	host: string;
	port: number;
	protocol: string;
	method: Method;
	path: string;
	extension: string | null;
	request: string;
	status: number;
	responselength: number;
	mimetype: string;
	response: string;
	comment: string;
}


const generatedUrls: {
	path: string,
	method: Method,
	needsBearer:boolean,
	hasRequestBody:boolean,
	hasResponseBody:boolean
}[] = [];

function nameFrom(method:Method,path:string){
	// Make letter after / uppercase
	path = method.toLowerCase()+'/'+path
	const parts = path.split('/')
	const name = parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')
	return name
}




const jsonInput = jsonInputForTargetLanguage('typescript');
for (const [path, methods] of reqsPerPath.entries()) {
	for (const [method, reqs] of methods.entries()) {
		const stringifiedReqs = reqs.map(req => Buffer.from(req.request,'base64').toString('utf-8'))
		const requestHeaders = stringifiedReqs.map(req => req.split('\r\n\r\n')[0])
		const requestBodies = stringifiedReqs.map(req => req.split('\r\n\r\n')[1])
		const needsBearer = requestHeaders.some(header => header.includes('Authorization: Bearer'))
		try{

			await jsonInput.addSource({
				name: `${nameFrom(method,path)}Request`,
				samples: requestBodies
			});
		}catch(e){ /* empty */ }


		const stringifiedRes = reqs.map(req => Buffer.from(req.response,'base64').toString('utf-8'))
		// const responseHeaders = stringifiedReqs.map(req => req.split('\r\n\r\n')[0])
		const responseBodies = stringifiedRes.map(req => req.split('\r\n\r\n')[1])
		try{
			await jsonInput.addSource({
				name: `${nameFrom(method,path)}Response`,
				samples: responseBodies
			});
		}catch(e){ /* empty */ }

		generatedUrls.push({
			path,
			method,
			needsBearer,
			hasRequestBody:requestBodies.some(body => body.length > 0),
			hasResponseBody:responseBodies.some(body => body.length > 0)
		})

	}
}

let outputString = '/* eslint-disable @typescript-eslint/no-explicit-any */\n'
const input = new InputData();
input.addInput(jsonInput);
const allTypes =  await quicktype({
	inputData: input,
	lang: 'typescript',
	rendererOptions:{
		'just-types':true,
		'prefer-types':true,
		'acronym-style':'original',
	},
})
outputString += allTypes.lines.join('\n')

for (const {path, method, needsBearer,hasRequestBody,hasResponseBody} of generatedUrls) {
	const output = `
	export async function ${method.toLowerCase()}${path.replace(/\//g,'_').replace(/\./g,'_').replace(/-/g,'_')}(
	   ${hasRequestBody?`request:${nameFrom(method,path)}Request,\n`:''}${needsBearer?'token:string':''}
	){
		${hasResponseBody?'const response = ':''}await fetch('${path}',{
			method:'${method}',
			headers:{
				${needsBearer?'\'Authorization\':\'Bearer \' + token,':''}
				'Content-Type':'application/json'
			},
			body: ${hasRequestBody?'JSON.stringify(request)':'undefined'}
		})${hasResponseBody?'\nreturn await response.json()':''}
	}
	`
	outputString += output
}
console.log(outputString)
