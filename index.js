import { setFailed, warning, getInput, notice } from '@actions/core';
import { context as _context, getOctokit } from '@actions/github';
import axios from 'axios';

function getIssueNumber(context) {
	let issueNumber = getInput("issue-number");

	if (issueNumber) return issueNumber;

	issueNumber = context.payload.issue && context.payload.issue.number;
	if (issueNumber) return issueNumber;

	return issueNumber;
}

function getZendeskIdFromIssue(issue) {
	if (!issue.title) {
		setFailed("No Issue title");
		return 0;
	}
	const title_parts = issue.title.split('-');

	if (title_parts) {
		const zendesk_id = parseInt(title_parts[0]);
		if (isNaN(zendesk_id)) {
			warning("Cannot parse zendesk id");
			return;
		}

		return zendesk_id;
	}

	warning("Unable to parse zendesk id from title.");
	return;
}

function getZenDeskStatusFromLabel(labelName) {
	const zendeskCaseStatus = {
	'Awaiting Verification': 'programmer-resolved',
		'QA': 'qa',
		'Returned to Support': 'programmer-returned'
	};


	return zendeskCaseStatus[labelName];
}

function setZendeskTicketStatus(zendesk_id, caseStatus, issue) {
	const auth_token_raw = getInput('zd_token');
	const zendesk_base_url = getInput('zd_base_url')
	const case_status_id = getInput('zd_case_status_id');
	const payload = getTicketPayload(caseStatus, issue, case_status_id);
	const encoded_token = Buffer.from(auth_token_raw).toString('base64')
	let zd_req = axios.put(`${zendesk_base_url}/api/v2/tickets/${zendesk_id}.json`, payload
		, {
			headers: {
				'Authorization': `Basic ${encoded_token}`
			}
		}
	)
		.then(() => { })
		.catch((error) => {
			setFailed(error);
		});

	return zd_req;
}

function getTicketPayload(caseStatus, issue, case_status_id) {
	let payload = {
		'ticket': {
			'custom_fields': [
				{ 'id': case_status_id, 'value': `${caseStatus}` }
			]
		}
	};

	if (caseStatus === "programmer-returned") {
		return payload;
	}


	if (issue.labels && issue.labels.length > 0) {
		let awaiting = issue.labels.find(l => l.name == "Awaiting Verification");
		if (awaiting) {
			payload = {
				'ticket': {
					'custom_fields': [
						{ 'id': case_status_id, 'value': `${caseStatus}` }
					]
					, 'followers': [
						{ "user_id": 415082549274 }
					]
				}
			};
		}
	}

	return payload;
}


async function log(issue_num, zendesk_id, caseStatus, rep) {
	try {
		await getRTToken().then(t => {
			const access_token = t.data.accessToken || '';
			const config = {
				headers: { Authorization: `Bearer ${access_token}` }
			};
			const request_body = {
				"ZendeskTicketId": zendesk_id,
				"GithubIssueNumber": issue_num,
				"CaseStatus": caseStatus,
				"SupportRep": rep
			};
			axios.post(
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
	const data = JSON.stringify({
		'refreshToken': `${rt_api_token}`
	});

	const config = {
		method: 'post',
		url: 'https://api.fridaysis.com/v1/token/accesstoken',
		headers: {
			'Content-Type': 'application/json'
		},
		data: data
	};
	const access_token = axios(config);
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

function GetLabelFromPayload(payload) {
	const label = payload.label;

	return label;
}


async function run() {
	const repo = getInput('repo');
	const token = getInput('token');

	const context = _context;
	const issue_num = getIssueNumber(context);
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
		return;
	}

	const actionableLabels = ['Awaiting Verification', 'QA', 'Returned to Support',];
	const label = GetLabelFromPayload(context.payload);
	if (!label) {
		setFailed("No label found");
		return;
	}
	const takeAction = actionableLabels.includes(label.name);

	if (!takeAction) {
		notice("Non-actionable label")
		return;
	}
	const zendeskCastStatus = getZenDeskStatusFromLabel(label.name);

	const zendesk_id = getZendeskIdFromIssue(issue)
	if (zendesk_id === 0) {
		notice("Bad Zendesk ID");
		return;
	}

	try {
		const rep = getRepFromIssue(issue);
		await log(issue_num, zendesk_id, zendeskCastStatus, rep);
	} catch (error) { }

	await setZendeskTicketStatus(zendesk_id, zendeskCastStatus, issue).then((_) => { });
	const status_comment = `Zendesk ticket status has been set to ${zendeskCastStatus}.`;
	await setStatusComment(octokit, owner_name, repo, issue_num, status_comment);

	notice("Job Completed");
	return "Job Completed";
}

function getRepFromIssue(issue) {
	const issue_as_arr = issue.body.split('\n');
	const issue_assignee = issue_as_arr.filter(s => {
		return s.includes("**Assignee:**");
	});
	let rep = 'unkown';
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
