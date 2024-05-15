import { XMLParser } from 'fast-xml-parser';
import Bun from 'bun';
import {
	quicktype,
	InputData,
	jsonInputForTargetLanguage,
	JSONSchemaInput,
	FetchingJSONSchemaStore,
	TargetLanguage,
	TypeScriptTargetLanguage
} from 'quicktype-core';


const burpLog = Bun.file('burplog.xml')

const parser = new XMLParser();
const xmlObj = parser.parse(await burpLog.text())

// console.log(xmlObj.items.item[0])

const reqsPerPath = new Map<string, BurpItem[]>()
for (let i = 0; i < xmlObj.items.item.length; i++) {
	const req = xmlObj.items.item[i] as BurpItem;
    
	if (req.host === 'redacted' && req.mimetype === 'JSON') {
		reqsPerPath.set(req.method + ' '+req.path, reqsPerPath.get(req.method + ' ' +req.path) ? reqsPerPath.get(req.method + ' ' +req.path)!.concat(req) : [req])
		// console.log(req.request)
		const rawRequest = Buffer.from(req.request, 'base64').toString('utf-8')
		const rawResponse = Buffer.from(req.response, 'base64').toString('utf-8')
		const requestBody = rawRequest.split('\r\n\r\n')[1]
		const responseBody = rawResponse.split('\r\n\r\n')[1]
        
		// console.log(req.url)
		// console.log(">>> "+request)
		// console.log("<<< "+response)
	}
}

interface BurpItem {
	time: string;
	url: string;
	host: string;
	port: number;
	protocol: string;
	method: string;
	path: string;
	extension: string | null;
	request: string;
	status: number;
	responselength: number;
	mimetype: string;
	response: string;
	comment: string;
}

async function quicktypeJSON(typeName:string, samples:string[]) {
	const jsonInput = jsonInputForTargetLanguage('typescript');

	// We could add multiple samples for the same desired
	// type, or many sources for other types. Here we're
	// just making one type from one piece of sample JSON.
	await jsonInput.addSource({
		name: typeName,
		samples: samples
	});

	const inputData = new InputData();
	inputData.addInput(jsonInput);

	return await quicktype({
		inputData,
		lang: new TypeScriptTargetLanguage(),
		indentation: '\t',
		rendererOptions:{
			'just-types':true,
			'prefer-types':true
		},

	});
}
for (const [path, reqs] of reqsPerPath.entries()) {
	console.log(path)
	const samples = reqs.map(req => Buffer.from(req.response,'base64').toString('utf-8').split('\r\n\r\n')[1])
	const typeName = path.split('/')[1]
	try {
		const { lines } = await quicktypeJSON(typeName, samples)
		console.log(lines.join('\n'))
	}catch(e){
		console.log(samples)
		console.error(e)
	}
	// const { lines } = await quicktypeJSON(typeName, samples)
	console.log('--------------------------------------------------')
}