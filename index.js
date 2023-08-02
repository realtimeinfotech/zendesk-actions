import core, { setFailed, warning, getInput, info } from '@actions/core';
import { context as _context, getOctokit } from '@actions/github';
import axios, { put, post } from 'axios';

function getIssueNumber(core, context) {
	let issueNumber = core.getInput("issue-number");

	if (issueNumber) return issueNumber;

	issueNumber = context.payload.issue && context.payload.issue.number;
	if (issueNumber) return issueNumber;

	let card_url = context.payload.project_card && context.payload.project_card.content_url;
	issueNumber = card_url && card_url.split("/").pop();

	return issueNumber;
}

function getZendeskIdFromIssue(issue) {
	if (!issue.title) {
		setFailed("No Issue title");
		return 0;
	}
	const title_parts = issue.title.split('-');
	if(title_parts) {
		const zendesk_id = parseInt(title_parts[0]);
		if (isNaN(zendesk_id)) {
			warning("Cannot parse zendesk id");
			return 0;
		}

		return zendesk_id;
	}

	warning("Unable to parse zendesk id from title.");
	return;
}

// TODO: Solidify columns and expand these values
function getProjectColumnFromContext(context) {
	const columns = [
		{id: 15338077, name: "qa", zd_case_status: "qa"}
		,{id: 15335031, name: "open", zd_case_status: "programming"}
		,{id: 15350799, name: "returned", zd_case_status: "programmer-returned"}
		,{id: 15399629, name: "resolved", zd_case_status: "programmer-resolved"}
		
	];

	if (!context || !context.payload || !context.payload.project_card || !context.payload.project_card.column_id) {
		setFailed("Cannot Find project_card or column_id in context");
		return;
	}

	const column_id = context.payload.project_card.column_id;
	const column = columns.filter(c => {
		return c.id == column_id;
	});

	return column[0];
}

function setZendeskTicketStatus(zendesk_id, column, issue) {
	const auth_token_raw = getInput('zd_token');
	const zendesk_base_url = getInput('zd_base_url')
	const case_status_id = getInput('zd_case_status_id');
	let payload = getTicketPayload(column, issue, case_status_id);
	let encoded_token = Buffer.from(auth_token_raw).toString('base64')
	let zd_req = put(`${zendesk_base_url}/api/v2/tickets/${zendesk_id}.json`, payload
		,{
			headers: {
				'Authorization': `Basic ${encoded_token}`
			}
		}
	)
	.then((res) => { })
	.catch((error) => {
		console.log(error)
		setFailed(error);
	});

	return zd_req;
}

function getTicketPayload(column, issue, case_status_id) {
	var payload = {
		'ticket': {
			'custom_fields': [
				{ 'id': case_status_id, 'value': `${column.zd_case_status}` }
			]
		}
	};

	if (column.name === "resolved") {
		return payload;
	}


	if (issue.labels && issue.labels.length > 0) {
		let awaiting = issue.labels.find(l => l.name == "Awaiting Verification");
		if (awaiting) {
			payload = {
				'ticket': {
					'custom_fields': [
						{ 'id': case_status_id, 'value': `${column.zd_case_status}` }
					]
					,'followers': [
						{ "user_id": 415082549274 }
					]
				}
			};
		}
	}

	return payload;
}


async function log(context, issue_num, zendesk_id, column_name, issue, rep) {
	try {
		await getRTToken().then(t => {
			const access_token = t.data.accessToken || '';
			const config = {
					headers: { Authorization: `Bearer ${access_token}`}
			};
			const request_body = {
				"ZendeskTicketId": zendesk_id,
				"GithubIssueNumber": issue_num,
				"CaseStatus": column_name,
				"SupportRep": rep
			};
			post(
				'https://api.fridaysis.com/v1/githubissuelog',
				request_body,
				config
			).then();
		});
	} catch (error) {
		console.log(error);
	}
}


async function getRTToken() {
	const rt_api_token = getInput('rt_api_token');
	let data = JSON.stringify({
		'refreshToken': `${rt_api_token}`
	});

	let config = {
		method: 'post',
		url: 'https://api.fridaysis.com/v1/token/accesstoken',
		headers: {
			'Content-Type': 'application/json'
		},
		data: data
	};
	let access_token = axios(config);
	return access_token;
}

async function setStatusComment(octokit, owner, repo, issue_number, body) {
	try {
		await octokit.rest.issues.createComment({
			owner,
			repo,
			issue_number,
			body
		});
	} catch (error) {
		console.log(error);
		return error;
	}
}

async function run() {
	const org = getInput('org');
	const repo = getInput('repo');
	const token = getInput('token');
	const context = _context;
	const issue_num = getIssueNumber(core, context);
	const repo_name = context.payload.repository.name;
	const owner_name = context.payload.repository.owner.login;
	const octokit = getOctokit(token);


	if (issue_num === undefined) {
		setFailed("No Issue number found, no action taken");
		return "error";
	}

	const { data: issue } = await octokit.rest.issues.get({
		owner: owner_name,
		repo: repo_name,
		issue_number: issue_num
	});

	if (!issue) {
		setFailed("No Issue found");
		return "error";
	}

	const zendesk_id = getZendeskIdFromIssue(issue)
	if (zendesk_id === 0) {
		return "";
	}
	const column = getProjectColumnFromContext(context);
	if (!column) {
		info("No Action required");
		return "";
	}

	const actionable_columns = ['qa','returned','open','resolved'];
	if (actionable_columns.indexOf(column.name) < 0) {
		info(`No action needed for column ${column.name}`);
		return "";
	}


	try {
		const rep = getRepFromIssue(issue);
		await log(context, issue_num, zendesk_id, column.name, issue, rep);
	} catch (error) { }

	await setZendeskTicketStatus(zendesk_id, column, issue).then((_) => { });
	const status_comment = `Zendesk ticket status has been set to ${column.name}.`;
	await setStatusComment(octokit, owner_name, repo, issue_num, status_comment);

	return "Job Completed";
}

function getRepFromIssue(issue) {
	var issue_as_arr = issue.body.split('\n');
	var issue_assignee = issue_as_arr.filter(s => {
		return s.includes("**Assignee:**");
	});
	var rep = 'unkown';
	if (issue_assignee.length === 1) {
		const rep_from_issue = issue_assignee[0].replace('**Assignee:**', '').trim();
		if (rep_from_issue !== "") {
			rep = rep_from_issue;
		}
	}

	return rep;
}

run() 
	.then(result => {
		console.log(result);
	}, err => {
		setFailed(err);
	})
	.then(() => {
		process.exit();
	});
