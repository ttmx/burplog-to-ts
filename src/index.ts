import { XMLParser } from 'fast-xml-parser';
import Bun from 'bun';
import {parseArgs} from 'util'
import {
	quicktype,
	InputData,
	jsonInputForTargetLanguage,
} from 'quicktype-core';


const { values, _ } = parseArgs({
	args: Bun.argv,
	options: {
		host: {
			short: 'h',
			type: 'string',
		},
		input:{
			short:'i',
			type:'string',
			default:'burplog.xml',
		}
	},
	allowPositionals: true,
})
console.error(values)
const burpLog = Bun.file(values.input as string)
const host = values.host as string

const parser = new XMLParser();
const xmlObj = parser.parse(await burpLog.text())

// console.log(xmlObj.items.item[0])

let commonPrefix = null
const reqsPerPath = new Map<string, Map<Method,BurpItem[]>>()
for (let i = 0; i < xmlObj.items.item.length; i++) {
	const req = xmlObj.items.item[i] as BurpItem;
    
	if (req.host === host) {
		const path = req.path.split('?')[0]
		if (commonPrefix === null) {
			commonPrefix = path
		}else{
			const prefixLength = commonPrefix.split('').reduce((acc,cur,i) => cur === path[i] ? acc+1 : acc,0)
			commonPrefix = commonPrefix.slice(0,prefixLength)
		}
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
	path = method.toLowerCase()+'/'+path.substring(commonPrefix.length)
	const parts = path.split('/')
	const name = parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')
	return name
}




let specialTypes = ''
const jsonInput = jsonInputForTargetLanguage('typescript');
for (const [path, methods] of reqsPerPath.entries()) {
	for (const [method, reqs] of methods.entries()) {
		const stringifiedReqs = reqs.map(req => Buffer.from(req.request,'base64').toString('utf-8'))
		const requestHeaders = stringifiedReqs.map(req => req.split('\r\n\r\n')[0])
		const requestBodies = stringifiedReqs.map(req => req.split('\r\n\r\n')[1])
		const needsBearer = requestHeaders.some(header => header.includes('Authorization: Bearer'))

		if (requestBodies.every(body => body === '[]')){
			specialTypes += `export type ${nameFrom(method,path)}Request = any[]\n`
		}
		let hasRequestBody = false
		try{
			await jsonInput.addSource({
				name: `${nameFrom(method,path)}Request`,
				samples: requestBodies
			});
			hasRequestBody = true
		}catch(e){ /* empty */ }



		const stringifiedRes = reqs.map(req => Buffer.from(req.response,'base64').toString('utf-8'))
		// const responseHeaders = stringifiedReqs.map(req => req.split('\r\n\r\n')[0])
		const responseBodies = stringifiedRes.map(req => req.split('\r\n\r\n')[1])
		if (responseBodies.every(body => body === '[]')){
			specialTypes += `export type ${nameFrom(method,path)}Response = any[]\n`
		}
		let hasResponseBody = false
		try{
			await jsonInput.addSource({
				name: `${nameFrom(method,path)}Response`,
				samples: responseBodies
			});
			hasResponseBody = true
		}catch(e){ /* empty */ }


		generatedUrls.push({
			path,
			method,
			needsBearer,
			hasRequestBody,
			hasResponseBody
		})

	}
}

let outputString = '/* eslint-disable @typescript-eslint/no-explicit-any */\n' + specialTypes + `\n const baseUrl = 'https://${host}'\n`
const input = new InputData();
input.addInput(jsonInput);
const allTypes =  await quicktype({
	inputData: input,
	lang: 'typescript',
	combineClasses: false,
	rendererOptions:{
		'just-types':true,
		'prefer-types':true,
		'acronym-style':'original',
	},
})
outputString += allTypes.lines.join('\n')

for (const {path, method, needsBearer,hasRequestBody,hasResponseBody} of generatedUrls) {
	const output = `
	export async function ${method.toLowerCase()}${path.replace(/\//g,'_').replace(/\./g,'_').replace(/-/g,'_')}(\n`+
	`${hasRequestBody?`request:${nameFrom(method,path)}Request,\n`:''}`+
	`${needsBearer?'token:string\n':''}`+
	`)${hasResponseBody?`:Promise<${nameFrom(method,path)}Response>`:''}{
		${hasResponseBody?'const response = ':''}await fetch(\`\${baseUrl}${path}\`,{
			method:'${method}',
			headers:{
				${needsBearer?'\'Authorization\':\'Bearer \' + token,':''}
				'Content-Type':'application/json'
			},
			body: ${hasRequestBody?'JSON.stringify(request)':'undefined'}
		})${hasResponseBody?`\nreturn response.json() as Promise<${nameFrom(method,path)}Response>`:''}
	}
	`
	outputString += output
}
console.log(outputString)
