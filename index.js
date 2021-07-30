const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

const rt_custom_fields = {
	'ticket_desc': {
		'arg': 'ticket.customField:custom_field_360046040673'
		,'id': 360046040673
	},
	'steps': {
		'arg': 'ticket.customField:custom_field_360045445353'
		,'id': 360045445353 
	},
	'category': {
		'arg': 'ticket.customField:custom_field_360045114893'
		,'id': 360045114893
	},
	'caseStatus': {
		'arg': 'ticket.customField:custom_field_360045119013'
		,'id': 360045119013
	}
};

function getIssueNumber(core, context) {
	let issueNumber = core.getInput("issue-number");

	if (issueNumber) return issueNumber;

	issueNumber = context.payload.issue && context.payload.issue.number;
	if (issueNumber) return issueNumber;

	let card_url = context.payload.project_card && context.payload.project_card.content_url;
	issueNumber = card_url && card_url.split("/").pop();

	return issueNumber;
}

async function getIssue(issueNumber, owner, repo, api) {
	const res = await api.rest.issues.get({
		owner: owner,
		repo: repo,
		issue_number: issueNumber,
	});

	return res;
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
		return "No issue number found, no action taken";
	}

	const { data: issue } = await octokit.rest.issues.get({
		owner: owner_name,
		repo: repo_name,
		issue_number: issue_num
	});

	if (!issue) {
		return "No Issue found.";
	}

	const zendesk_id = getZendeskIdFromIssue(issue)
	const column = getProjectColumnFromContext(context);
	updateZendeskTicket(zendesk_id, column);

	return "Job Completed";
}

function getZendeskIdFromIssue(issue) {
	if (!issue.title) {
		return 0;
	}
	const title_parts = issue.title.split('-');
	if(title_parts) {
		const zendesk_id = parseInt(title_parts[0]);
		if (isNaN(zendesk_id)) {
			return 0
		}

		return zendesk_id;
	}

	return 0;
}

// TODO: Solidy columns and expand these values
function getProjectColumnFromContext(context) {
	const columns = [
		{id: 15338077, name: "qa"}
		,{id: 15335031, name: "open"}
	];

	if (!context || !context.payload || !context.payload.project_card || !context.payload.project_card.column_id) {
		return "Cannot Find project_card or column_id in context";
	}

	const column_id = context.payload.project_card.column_id;
	const column = columns.filter(c => {
		return c.id == column_id;
	});

	return column[0];
}

function updateZendeskTicket(zendesk_id, project_column) {
	if (project_column.name === 'qa')  {
		console.log('updating zendesk ticket ' + zendesk_id +'.  for project column ' + project_column.name);
		setZendeskTicketStatus(zendesk_id, project_column.name).then((r) => {
			console.log(r);
		});
	}
	return;
}

async function setZendeskTicketStatus(zendesk_id, zd_status) {
	const auth_token_raw = core.getInput('zd_token');
	console.log(auth_token_raw);
	let encoded_token = Buffer.from(auth_token_raw).toString('base64')
	let request = axios.put('https://realitincsupport.zendesk.com/api/v2/tickets/223921.json', {
				'ticket': {
					'custom_fields': [
						{'id': 360045119013, 'value': 'qa' }
					]
				}
		},
		{
			headers: {
				'Authorization': `Basic ${encoded_token}`
			}
		}
	)
	.then((res) => {
		console.log('within set status');
		console.log(res.data)
	})
	.catch((error) => {
		console.log(error)
	});

}

run() 
	.then(result => {
		console.log(result);
	}, err => {
		console.log(err);
	})
	.then(() => {
		process.exit();
	});
