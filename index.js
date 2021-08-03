const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

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
		core.setFailed("No Issue title");
		return;
	}
	const title_parts = issue.title.split('-');
	if(title_parts) {
		const zendesk_id = parseInt(title_parts[0]);
		if (isNaN(zendesk_id)) {
			core.setFailed("Cannot parse zendesk id");
			return;
		}

		return zendesk_id;
	}

	core.setFailed("Unable to parse zendesk id from title.");
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
		core.setFailed("Cannot Find project_card or column_id in context");
		return;
	}

	const column_id = context.payload.project_card.column_id;
	const column = columns.filter(c => {
		return c.id == column_id;
	});

	return column[0];
}

function setZendeskTicketStatus(zendesk_id, column) {
	const auth_token_raw = core.getInput('zd_token');
	const zendesk_base_url = core.getInput('zd_base_url')
	const case_status_id = core.getInput('zd_case_status_id');
	let encoded_token = Buffer.from(auth_token_raw).toString('base64')
	let zd_req = axios.put(`${zendesk_base_url}/api/v2/tickets/${zendesk_id}.json`, 
		{
			'ticket': {
				'custom_fields': [
					{ 'id': case_status_id, 'value': `${column.zd_case_status}` }
				]
			}
		},
		{
			headers: {
				'Authorization': `Basic ${encoded_token}`
			}
		}
	)
	.then((res) => { })
	.catch((error) => {
		console.log(error)
		core.setFailed(error);
	});

	return zd_req;
}

async function run() {
	const org = core.getInput('org');
	const repo = core.getInput('repo');
	const token = core.getInput('token');
	const context = github.context;
	const issue_num = getIssueNumber(core, context);
	const repo_name = context.payload.repository.name;
	const owner_name = context.payload.repository.owner.login;
	const octokit = github.getOctokit(token);


	if (issue_num === undefined) {
		core.setFailed("No Issue number found, no action taken");
		return "error";
	}

	const { data: issue } = await octokit.rest.issues.get({
		owner: owner_name,
		repo: repo_name,
		issue_number: issue_num
	});

	if (!issue) {
		core.setFailed("No Issue found");
		return "error";
	}

	const zendesk_id = getZendeskIdFromIssue(issue)
	const column = getProjectColumnFromContext(context);

	const actionable_columns = ['qa','returned','open','resolved'];
	if (actionable_columns.indexOf(column.name) < 0) {
		return `No action needed for column ${column.name}`;
	}

	await setZendeskTicketStatus(zendesk_id, column).then((r) => { });

	return "Job Completed";
}

run() 
	.then(result => {
		console.log(result);
	}, err => {
		core.setFailed(err);
	})
	.then(() => {
		process.exit();
	});
